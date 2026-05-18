"""
subtitle_quality.py — SRT Quality Analyzer
───────────────────────────────────────────
Đo các chỉ số chất lượng phụ đề: CPS, CPL, Gap, ASR heuristics.
Không sửa file, chỉ đọc và báo cáo.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Literal

from models.subtitle_optimizer import (
    MAX_CPS,
    MAX_CPL_VI,
    MIN_DURATION,
    MAX_DURATION,
    MIN_GAP,
    SubtitleBlock,
    parse_srt,
)

MAX_CPL_EN = 42

# Whisper/Kyutai hallucination: cùng từ/phrase lặp liên tiếp >= ngưỡng này
REPETITION_MIN_WORDS = 2        # cụm >= 2 từ mới tính
REPETITION_MIN_REPEAT = 3       # phải xuất hiện >= 3 lần liên tiếp


# ─────────────────────────────────────────────────────────────────
# Per-block result
# ─────────────────────────────────────────────────────────────────

@dataclass
class BlockReport:
    index: int
    start: float
    end: float
    text: str
    duration: float
    cps: float
    longest_line: int
    line_count: int
    gap_to_next: float | None       # None cho block cuối
    # violations
    cps_violation: bool
    cpl_violation: bool
    duration_short: bool            # duration < MIN_DURATION
    duration_long: bool             # duration > MAX_DURATION
    gap_violation: bool             # gap_to_next < MIN_GAP (None → False)
    repetition_detected: bool       # ASR heuristic
    repeated_phrase: str | None     # chuỗi lặp nếu có


# ─────────────────────────────────────────────────────────────────
# Summary
# ─────────────────────────────────────────────────────────────────

@dataclass
class QualityReport:
    lang: str                           # "en" hoặc "vi"
    total_blocks: int
    total_duration: float               # thời lượng phụ đề (giây)

    # Violation counts
    cps_violations: int
    cpl_violations: int
    duration_short_violations: int
    duration_long_violations: int
    gap_violations: int
    repetition_violations: int

    # Percentages
    cps_violation_pct: float
    cpl_violation_pct: float
    gap_violation_pct: float

    # CPS stats
    avg_cps: float
    max_cps: float
    median_cps: float

    # CPL stats
    avg_longest_line: float
    max_longest_line: int

    # Gap stats (giữa các block liên tiếp)
    avg_gap: float
    min_gap: float

    # Per-block detail
    blocks: list[BlockReport]

    # Top offenders (worst CPS/CPL blocks)
    worst_cps_blocks: list[BlockReport]     # top 5 CPS cao nhất
    worst_cpl_blocks: list[BlockReport]     # top 5 CPL dài nhất

    def to_dict(self) -> dict:
        def block_to_dict(b: BlockReport) -> dict:
            return {
                "index": b.index,
                "start": b.start,
                "end": b.end,
                "text": b.text,
                "duration": round(b.duration, 3),
                "cps": round(b.cps, 2),
                "longest_line": b.longest_line,
                "line_count": b.line_count,
                "gap_to_next": round(b.gap_to_next, 3) if b.gap_to_next is not None else None,
                "violations": {
                    "cps": b.cps_violation,
                    "cpl": b.cpl_violation,
                    "duration_short": b.duration_short,
                    "duration_long": b.duration_long,
                    "gap": b.gap_violation,
                    "repetition": b.repetition_detected,
                },
                "repeated_phrase": b.repeated_phrase,
            }

        return {
            "lang": self.lang,
            "total_blocks": self.total_blocks,
            "total_duration": round(self.total_duration, 2),
            "violations": {
                "cps": self.cps_violations,
                "cpl": self.cpl_violations,
                "duration_short": self.duration_short_violations,
                "duration_long": self.duration_long_violations,
                "gap": self.gap_violations,
                "repetition": self.repetition_violations,
            },
            "violation_pct": {
                "cps": round(self.cps_violation_pct, 1),
                "cpl": round(self.cpl_violation_pct, 1),
                "gap": round(self.gap_violation_pct, 1),
            },
            "cps_stats": {
                "avg": round(self.avg_cps, 2),
                "max": round(self.max_cps, 2),
                "median": round(self.median_cps, 2),
                "threshold": MAX_CPS,
            },
            "cpl_stats": {
                "avg_longest_line": round(self.avg_longest_line, 1),
                "max_longest_line": self.max_longest_line,
                "threshold": MAX_CPL_VI if self.lang == "vi" else MAX_CPL_EN,
            },
            "gap_stats": {
                "avg": round(self.avg_gap, 3) if self.avg_gap else None,
                "min": round(self.min_gap, 3) if self.min_gap < float("inf") else None,
                "threshold": MIN_GAP,
            },
            "worst_cps_blocks": [block_to_dict(b) for b in self.worst_cps_blocks],
            "worst_cpl_blocks": [block_to_dict(b) for b in self.worst_cpl_blocks],
            "blocks": [block_to_dict(b) for b in self.blocks],
        }


# ─────────────────────────────────────────────────────────────────
# ASR Heuristic: repetition / hallucination detection
# ─────────────────────────────────────────────────────────────────

def _detect_repetition(text: str) -> tuple[bool, str | None]:
    """
    Phát hiện Whisper hallucination: cùng từ/phrase lặp liên tiếp.

    Ví dụ bị flag:
        "thank you thank you thank you for watching"
        "the the the cat sat on the mat"

    Thuật toán:
        1. Tokenize text thành words
        2. Với mỗi window size w = 1..4 từ:
           Duyệt i, kiểm tra words[i:i+w] == words[i+w:i+2w] == words[i+2w:i+3w]
           (3 lần lặp liên tiếp)
        3. Nếu tìm thấy → trả về (True, phrase)
    """
    words = text.lower().split()
    n = len(words)

    for w in range(1, min(5, n // REPETITION_MIN_REPEAT + 1)):
        for i in range(n - w * REPETITION_MIN_REPEAT + 1):
            chunks = [words[i + j * w: i + (j + 1) * w] for j in range(REPETITION_MIN_REPEAT)]
            if all(c == chunks[0] for c in chunks[1:]):
                phrase = " ".join(chunks[0])
                return True, phrase

    return False, None


# ─────────────────────────────────────────────────────────────────
# Core analyzer
# ─────────────────────────────────────────────────────────────────

def analyze_srt(srt_content: str, lang: Literal["en", "vi"] = "vi") -> QualityReport:
    """
    Phân tích SRT string và trả về QualityReport đầy đủ.

    Args:
        srt_content: Nội dung file .srt dạng string
        lang: "en" hoặc "vi" — xác định ngưỡng CPL

    Returns:
        QualityReport với per-block detail và summary stats
    """
    blocks = parse_srt(srt_content)
    if not blocks:
        return _empty_report(lang)

    cpl_threshold = MAX_CPL_VI if lang == "vi" else MAX_CPL_EN
    n = len(blocks)
    block_reports: list[BlockReport] = []

    for i, blk in enumerate(blocks):
        # Gap tới block kế tiếp
        if i + 1 < n:
            gap = round(blocks[i + 1].start - blk.end, 4)
        else:
            gap = None

        rep_detected, rep_phrase = _detect_repetition(blk.text)

        br = BlockReport(
            index=blk.index,
            start=blk.start,
            end=blk.end,
            text=blk.text,
            duration=round(blk.duration, 3),
            cps=round(blk.cps, 3),
            longest_line=blk.longest_line,
            line_count=len(blk.lines),
            gap_to_next=gap,
            cps_violation=blk.cps > MAX_CPS,
            cpl_violation=blk.longest_line > cpl_threshold,
            duration_short=blk.duration < MIN_DURATION,
            duration_long=blk.duration > MAX_DURATION,
            gap_violation=(gap is not None and gap < MIN_GAP),
            repetition_detected=rep_detected,
            repeated_phrase=rep_phrase,
        )
        block_reports.append(br)

    # ── CPS stats ──
    cps_values = [b.cps for b in block_reports]
    cps_violations = sum(1 for v in cps_values if v > MAX_CPS)
    avg_cps = sum(cps_values) / n
    max_cps = max(cps_values)
    sorted_cps = sorted(cps_values)
    median_cps = sorted_cps[n // 2] if n % 2 else (sorted_cps[n // 2 - 1] + sorted_cps[n // 2]) / 2

    # ── CPL stats ──
    cpl_values = [b.longest_line for b in block_reports]
    cpl_violations = sum(1 for v in cpl_values if v > cpl_threshold)
    avg_longest_line = sum(cpl_values) / n
    max_longest_line = max(cpl_values)

    # ── Duration stats ──
    duration_short_violations = sum(1 for b in block_reports if b.duration_short)
    duration_long_violations = sum(1 for b in block_reports if b.duration_long)

    # ── Gap stats ──
    gaps = [b.gap_to_next for b in block_reports if b.gap_to_next is not None]
    gap_violations = sum(1 for g in gaps if g < MIN_GAP)
    avg_gap = sum(gaps) / len(gaps) if gaps else 0.0
    min_gap = min(gaps) if gaps else float("inf")

    # ── Repetition ──
    repetition_violations = sum(1 for b in block_reports if b.repetition_detected)

    # ── Pct ──
    def pct(count: int) -> float:
        return round(count / n * 100, 1) if n else 0.0

    # ── Top offenders ──
    worst_cps = sorted(block_reports, key=lambda b: b.cps, reverse=True)[:5]
    worst_cpl = sorted(block_reports, key=lambda b: b.longest_line, reverse=True)[:5]

    total_duration = blocks[-1].end - blocks[0].start if blocks else 0.0

    return QualityReport(
        lang=lang,
        total_blocks=n,
        total_duration=round(total_duration, 2),
        cps_violations=cps_violations,
        cpl_violations=cpl_violations,
        duration_short_violations=duration_short_violations,
        duration_long_violations=duration_long_violations,
        gap_violations=gap_violations,
        repetition_violations=repetition_violations,
        cps_violation_pct=pct(cps_violations),
        cpl_violation_pct=pct(cpl_violations),
        gap_violation_pct=pct(gap_violations),
        avg_cps=avg_cps,
        max_cps=max_cps,
        median_cps=median_cps,
        avg_longest_line=avg_longest_line,
        max_longest_line=max_longest_line,
        avg_gap=avg_gap,
        min_gap=min_gap,
        blocks=block_reports,
        worst_cps_blocks=worst_cps,
        worst_cpl_blocks=worst_cpl,
    )


def analyze_srt_file(path: str, lang: Literal["en", "vi"] = "vi") -> QualityReport:
    """Đọc file .srt từ disk rồi gọi analyze_srt()."""
    with open(path, encoding="utf-8-sig") as f:
        content = f.read()
    return analyze_srt(content, lang)


# ─────────────────────────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────────────────────────

def _empty_report(lang: str) -> QualityReport:
    return QualityReport(
        lang=lang, total_blocks=0, total_duration=0.0,
        cps_violations=0, cpl_violations=0, duration_short_violations=0,
        duration_long_violations=0, gap_violations=0, repetition_violations=0,
        cps_violation_pct=0.0, cpl_violation_pct=0.0, gap_violation_pct=0.0,
        avg_cps=0.0, max_cps=0.0, median_cps=0.0,
        avg_longest_line=0.0, max_longest_line=0,
        avg_gap=0.0, min_gap=0.0,
        blocks=[], worst_cps_blocks=[], worst_cpl_blocks=[],
    )
