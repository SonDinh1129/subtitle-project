"""
subtitle_optimizer.py — Subtitle Post-Processing Engine
────────────────────────────────────────────────────────
Optimizes Vietnamese SRT files to broadcast/Netflix standards.
Pipeline: fix_duration → fix_cpl → fix_cps → fix_gap
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, replace

logger = logging.getLogger(__name__)

# ─────────────────────────────────────────────────────────────────
# CONSTANTS — Broadcast/Netflix standards
# ─────────────────────────────────────────────────────────────────

MAX_CPS = 17.0          # Characters per second
MAX_CPL_VI = 47         # Characters per line — Vietnamese
MAX_LINES = 2           # Max lines per subtitle block
MIN_DURATION = 1.0      # Minimum display time (seconds)
MAX_DURATION = 7.0      # Maximum display time (seconds)
MIN_GAP = 0.083         # ~2 frames @ 24fps (seconds)


# ─────────────────────────────────────────────────────────────────
# DATA STRUCTURE
# ─────────────────────────────────────────────────────────────────

@dataclass
class SubtitleBlock:
    index: int      # SRT sequence number
    start: float    # Start timestamp (seconds)
    end: float      # End timestamp (seconds)
    text: str       # Content (may contain \n for multi-line)

    @property
    def duration(self) -> float:
        return self.end - self.start

    @property
    def cps(self) -> float:
        if self.duration <= 0:
            return 0.0
        return len(self.text.replace('\n', '')) / self.duration

    @property
    def lines(self) -> list[str]:
        return self.text.split('\n')

    @property
    def longest_line(self) -> int:
        if not self.lines:
            return 0
        return max(len(line) for line in self.lines)


# ─────────────────────────────────────────────────────────────────
# SRT PARSE / WRITE
# ─────────────────────────────────────────────────────────────────

def _parse_srt_time(s: str) -> float:
    """'01:02:03,456' -> seconds as float."""
    h, m, rest = s.split(':')
    sec, ms = rest.split(',')
    return int(h) * 3600 + int(m) * 60 + int(sec) + int(ms) / 1000


def _fmt_srt_time(seconds: float) -> str:
    """Seconds to SRT timestamp format."""
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = round((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def parse_srt(content: str) -> list[SubtitleBlock]:
    """Parse SRT string to list of SubtitleBlock."""
    content = content.lstrip('\ufeff')  # Strip BOM
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    if not content.strip():
        return []
    pattern = re.compile(
        r'(\d+)\s*\n'
        r'(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\s*\n'
        r'(.*?)(?=\n\n|\Z)',
        re.DOTALL,
    )
    blocks = []
    for match in pattern.finditer(content.strip() + '\n\n'):
        index = int(match.group(1))
        start = _parse_srt_time(match.group(2))
        end = _parse_srt_time(match.group(3))
        text = match.group(4).strip()
        blocks.append(SubtitleBlock(index, start, end, text))
    return blocks


def write_srt(blocks: list[SubtitleBlock]) -> str:
    """List of SubtitleBlock to SRT string."""
    parts = []
    for block in blocks:
        parts.append(
            f"{block.index}\n"
            f"{_fmt_srt_time(block.start)} --> {_fmt_srt_time(block.end)}\n"
            f"{block.text}\n"
        )
    return '\n'.join(parts)


# ─────────────────────────────────────────────────────────────────
# SPLIT HELPERS
# ─────────────────────────────────────────────────────────────────

def find_best_split(text: str, mid: int) -> int:
    """Find best split position near mid."""
    window = max(10, len(text) // 5)
    search_start = max(0, mid - window)
    search_end = min(len(text), mid + window)

    # Priority: sentence-ending punctuation nearest to mid
    for punct in ['.', '?', '!', ';', ',', '\u2014']:
        best = -1
        best_dist = float('inf')
        for pos in range(search_start, search_end):
            if text[pos] == punct:
                dist = abs(pos - mid)
                if dist < best_dist:
                    best_dist = dist
                    best = pos
        if best != -1:
            return best + 1  # split after punctuation

    # Fallback: whitespace nearest to mid — prefer left so part2 gets more chars
    for offset in range(1, window + 1):
        if mid - offset >= 0 and text[mid - offset] == ' ':
            return mid - offset
        if mid + offset < len(text) and text[mid + offset] == ' ':
            return mid + offset

    # Last resort
    return mid


def split_block(block: SubtitleBlock) -> list[SubtitleBlock]:
    """Split block > MAX_DURATION into 2+ blocks recursively.

    Timing: duration allocated proportional to character count.
    """
    if block.duration <= MAX_DURATION:
        return [block]

    text = block.text.replace('\n', ' ')
    if len(text) < 2:
        # Text too short to split meaningfully — cap duration
        return [replace(block, end=round(block.start + MAX_DURATION, 3))]

    mid = len(text) // 2
    split_pos = find_best_split(text, mid)

    part1_text = text[:split_pos].strip()
    part2_text = text[split_pos:].strip()

    # Handle edge: split produced empty part
    if not part1_text:
        return [replace(block, text=part2_text)]
    if not part2_text:
        return [replace(block, text=part1_text)]

    total_chars = len(part1_text) + len(part2_text)
    ratio = len(part1_text) / total_chars if total_chars > 0 else 0.5
    split_time = block.start + block.duration * ratio

    part1 = SubtitleBlock(0, block.start, round(split_time, 3), part1_text)
    part2 = SubtitleBlock(0, round(split_time, 3), block.end, part2_text)

    return split_block(part1) + split_block(part2)


def extend_block(
    block: SubtitleBlock, next_block: SubtitleBlock | None,
) -> SubtitleBlock | list[SubtitleBlock]:
    """Extend block < MIN_DURATION.

    - No next_block: extend end to start + MIN_DURATION
    - Has next_block with room: extend end, preserve MIN_GAP
    - Extend would overlap next_block: merge both blocks
    """
    target_end = block.start + MIN_DURATION

    if next_block is None:
        return replace(block, end=target_end)

    available = next_block.start - MIN_GAP
    if target_end <= available:
        return replace(block, end=target_end)
    else:
        merged_text = ' '.join([
            block.text.replace('\n', ' '),
            next_block.text.replace('\n', ' '),
        ])
        # Merged block may violate Duration/CPL/CPS — caught by next iteration
        return [SubtitleBlock(0, block.start, next_block.end, merged_text)]


# ─────────────────────────────────────────────────────────────────
# PIPELINE STEP 1: fix_duration
# ─────────────────────────────────────────────────────────────────

def fix_duration(blocks: list[SubtitleBlock]) -> tuple[list[SubtitleBlock], bool]:
    """Split blocks > MAX_DURATION, extend blocks < MIN_DURATION."""
    result: list[SubtitleBlock] = []
    changed = False
    skip_next = False

    for i, block in enumerate(blocks):
        if skip_next:
            skip_next = False
            continue

        if block.duration > MAX_DURATION:
            result.extend(split_block(block))
            changed = True
        elif block.duration < MIN_DURATION:
            next_block = blocks[i + 1] if i + 1 < len(blocks) else None
            extended = extend_block(block, next_block)
            if isinstance(extended, list):
                result.extend(extended)
                skip_next = True  # next_block absorbed into merge
            else:
                result.append(extended)
            changed = True
        else:
            result.append(block)

    return result, changed
