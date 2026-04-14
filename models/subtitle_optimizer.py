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
