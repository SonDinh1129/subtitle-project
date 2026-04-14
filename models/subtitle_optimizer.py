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


# ─────────────────────────────────────────────────────────────────
# TEXT WRAPPING
# ─────────────────────────────────────────────────────────────────

def wrap_text(text: str, max_cpl: int) -> list[str]:
    """Greedy wrap, prefer balanced top-heavy lines.

    Top-heavy = line 1 >= line 2 in length.
    Greedy wrap naturally creates top-heavy output (fills from left),
    matching bottom-screen subtitle convention.
    """
    words = text.split()
    if not words:
        return ['']

    # If text fits on one line, return as-is
    if len(text) <= max_cpl:
        return [text]

    # Try balanced 2-line split first
    total = len(text)
    if total <= max_cpl * 2:
        best = _find_balanced_split(words, max_cpl)
        if best:
            return best

    # Fallback: greedy wrap
    lines: list[str] = []
    current = ''
    for word in words:
        if current and len(current) + 1 + len(word) > max_cpl:
            lines.append(current)
            current = word
        else:
            current = f'{current} {word}'.strip()
    if current:
        lines.append(current)
    return lines


def _find_balanced_split(words: list[str], max_cpl: int) -> list[str] | None:
    """Find split point where line1 >= line2 (top-heavy)."""
    cumulative: list[str] = []
    current = ''
    for word in words:
        current = f'{current} {word}'.strip()
        cumulative.append(current)

    full_text = cumulative[-1]
    for i in range(len(words) - 1):
        line1 = cumulative[i]
        line2 = full_text[len(line1):].strip()
        if len(line1) > max_cpl or len(line2) > max_cpl:
            continue
        if len(line1) >= len(line2):
            return [line1, line2]

    return None


# ─────────────────────────────────────────────────────────────────
# PIPELINE STEP 2: fix_cpl
# ─────────────────────────────────────────────────────────────────

def fix_cpl(
    blocks: list[SubtitleBlock], max_cpl: int = MAX_CPL_VI,
) -> tuple[list[SubtitleBlock], bool]:
    """Wrap text so each line <= max_cpl, max MAX_LINES lines.

    If text cannot fit in MAX_LINES x max_cpl, split into multiple blocks.
    Empty-text blocks are removed.
    """
    result: list[SubtitleBlock] = []
    changed = False

    for block in blocks:
        flat_text = block.text.replace('\n', ' ')

        if not flat_text.strip():
            changed = True
            continue

        if len(flat_text) <= max_cpl:
            if block.text != flat_text:
                result.append(replace(block, text=flat_text))
                changed = True
            else:
                result.append(block)
            continue

        lines = wrap_text(flat_text, max_cpl)

        if len(lines) <= MAX_LINES:
            new_text = '\n'.join(lines)
            if new_text != block.text:
                result.append(replace(block, text=new_text))
                changed = True
            else:
                result.append(block)
        else:
            # Text too long for MAX_LINES — split block
            # New blocks may have duration < MIN_DURATION — caught by next iteration
            splits = _split_block_by_text(block, lines)
            result.extend(splits)
            changed = True

    return result, changed


def _split_block_by_text(
    block: SubtitleBlock, lines: list[str],
) -> list[SubtitleBlock]:
    """Split block when text needs > MAX_LINES lines.

    Groups lines into chunks of MAX_LINES, allocates duration
    proportional to character count.
    """
    groups: list[str] = []
    for i in range(0, len(lines), MAX_LINES):
        group_lines = lines[i:i + MAX_LINES]
        groups.append('\n'.join(group_lines))

    total_chars = sum(len(g.replace('\n', '')) for g in groups)
    blocks_out: list[SubtitleBlock] = []
    current_start = block.start

    for g in groups:
        ratio = len(g.replace('\n', '')) / total_chars if total_chars > 0 else 1.0
        duration = block.duration * ratio
        end = round(current_start + duration, 3)
        blocks_out.append(SubtitleBlock(0, round(current_start, 3), end, g))
        current_start = end

    # Ensure last block ends exactly at original end
    if blocks_out:
        blocks_out[-1] = replace(blocks_out[-1], end=block.end)

    return blocks_out


# ─────────────────────────────────────────────────────────────────
# PIPELINE STEP 3: fix_cps
# ─────────────────────────────────────────────────────────────────

def _split_block_by_chars(block: SubtitleBlock) -> list[SubtitleBlock]:
    """Split block into two parts by character ratio, preserving original timing.

    Used by fix_cps when the block can't be extended and must be divided.
    Unlike split_block (which splits by MAX_DURATION), this always splits
    regardless of duration, allocating time proportional to character count.
    """
    text = block.text.replace('\n', ' ')
    if len(text) < 2:
        return [block]

    mid = len(text) // 2
    split_pos = find_best_split(text, mid)

    part1_text = text[:split_pos].strip()
    part2_text = text[split_pos:].strip()

    if not part1_text:
        return [replace(block, text=part2_text)]
    if not part2_text:
        return [replace(block, text=part1_text)]

    total_chars = len(part1_text) + len(part2_text)
    ratio = len(part1_text) / total_chars if total_chars > 0 else 0.5
    split_time = round(block.start + block.duration * ratio, 3)

    part1 = SubtitleBlock(0, block.start, split_time, part1_text)
    part2 = SubtitleBlock(0, split_time, block.end, part2_text)

    return [part1, part2]


def fix_cps(blocks: list[SubtitleBlock]) -> tuple[list[SubtitleBlock], bool]:
    """Ensure each block has CPS <= MAX_CPS.

    Strategy:
    1. Extend duration (if gap available after block)
    2. Fallback: split block by character ratio
    Dead-lock: if split creates blocks < MIN_DURATION, accept violation.
    """
    result: list[SubtitleBlock] = []
    changed = False

    for i, block in enumerate(blocks):
        if block.cps <= MAX_CPS:
            result.append(block)
            continue

        char_count = len(block.text.replace('\n', ''))
        needed_duration = char_count / MAX_CPS

        # Strategy A: extend end time
        # float('inf') for last block — can extend freely, limited only by MAX_DURATION
        next_start = blocks[i + 1].start if i + 1 < len(blocks) else float('inf')
        max_end = next_start - MIN_GAP
        target_end = block.start + needed_duration

        # Note: we check blocks[i+1].start (original list), not result[-1].end.
        # Safe because extend only affects forward direction.
        if target_end <= max_end and needed_duration <= MAX_DURATION:
            result.append(replace(block, end=round(target_end, 3)))
            changed = True
            continue

        # Strategy B: split block by character ratio
        splits = _split_block_by_chars(block)

        # Dead-lock guard: accept CPS violation if split is impossible or unhelpful
        if len(splits) == 1:
            result.append(block)
            logger.warning(
                "Block %d: CPS=%.1f — text too short to split, accepting violation",
                block.index, block.cps,
            )
        elif any(s.duration < MIN_DURATION for s in splits):
            result.append(block)
            logger.warning(
                "Block %d: CPS=%.1f — split creates blocks < %.1fs, accepting violation",
                block.index, block.cps, MIN_DURATION,
            )
        else:
            result.extend(splits)
            changed = True

    return result, changed


# ─────────────────────────────────────────────────────────────────
# PIPELINE STEP 4: fix_gap
# ─────────────────────────────────────────────────────────────────

def fix_gap(blocks: list[SubtitleBlock]) -> list[SubtitleBlock]:
    """Ensure gap between consecutive blocks >= MIN_GAP (83ms).

    No changed flag — always runs, does not contribute to convergence
    check. Gap fix may increase CPS of prev block (shortens duration).
    Accepted trade-off: gap correctness > CPS in single pass.
    fix_cps catches it in next iteration.

    Strategy:
    - gap < MIN_GAP: shrink prev.end
    - shrink would create prev < MIN_DURATION: merge blocks
    """
    if len(blocks) <= 1:
        return list(blocks)

    result = [blocks[0]]

    for i in range(1, len(blocks)):
        prev = result[-1]
        curr = blocks[i]
        gap = curr.start - prev.end

        if gap < 0:
            logger.warning("Block %d -> %d: overlap %.3fs", i - 1, i, abs(gap))

        if gap >= MIN_GAP:
            result.append(curr)
            continue

        new_prev_end = curr.start - MIN_GAP

        if new_prev_end - prev.start >= MIN_DURATION:
            result[-1] = replace(prev, end=round(new_prev_end, 3))
            result.append(curr)
        else:
            # Merge — curr absorbed into prev
            merged_text = ' '.join([
                prev.text.replace('\n', ' '),
                curr.text.replace('\n', ' '),
            ])
            merged_block = SubtitleBlock(0, prev.start, curr.end, merged_text)

            # Inline CPL fix — defensive, avoids edge case on last iteration
            lines = wrap_text(merged_block.text, MAX_CPL_VI)
            if len(lines) <= MAX_LINES:
                merged_block = replace(merged_block, text='\n'.join(lines))

            result[-1] = merged_block

    return result


# ─────────────────────────────────────────────────────────────────
# MAIN PIPELINE
# ─────────────────────────────────────────────────────────────────

def optimize_subtitles(blocks: list[SubtitleBlock]) -> list[SubtitleBlock]:
    """Main entry — run pipeline loop until convergence or max 3 iterations."""
    if not blocks:
        return []

    for _ in range(3):
        blocks, d_changed = fix_duration(blocks)
        blocks, c_changed = fix_cpl(blocks, max_cpl=MAX_CPL_VI)
        blocks, s_changed = fix_cps(blocks)
        blocks = fix_gap(blocks)  # always runs — no convergence check needed
        if not (d_changed or c_changed or s_changed):
            break

    # Re-index
    for i, block in enumerate(blocks, 1):
        block.index = i

    # Log remaining violations
    for block in blocks:
        if block.cps > MAX_CPS:
            logger.warning(
                "Block %d: CPS=%.1f > %.1f — could not fix",
                block.index, block.cps, MAX_CPS,
            )

    return blocks


# ─────────────────────────────────────────────────────────────────
# STATS
# ─────────────────────────────────────────────────────────────────

def get_optimization_stats(
    before: list[SubtitleBlock], after: list[SubtitleBlock],
) -> dict:
    """Compare before/after optimization metrics."""
    return {
        "blocks_before": len(before),
        "blocks_after": len(after),
        "cps_violations_before": sum(1 for b in before if b.cps > MAX_CPS),
        "cps_violations_after": sum(1 for b in after if b.cps > MAX_CPS),
        "cpl_violations_before": sum(1 for b in before if b.longest_line > MAX_CPL_VI),
        "cpl_violations_after": sum(1 for b in after if b.longest_line > MAX_CPL_VI),
        "avg_cps_before": round(sum(b.cps for b in before) / len(before), 1) if before else 0,
        "avg_cps_after": round(sum(b.cps for b in after) / len(after), 1) if after else 0,
    }
