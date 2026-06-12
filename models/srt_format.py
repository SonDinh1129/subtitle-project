"""
srt_format.py — Pure SRT string helpers (no heavy deps).

Split out from subtitle_model.py so the formatting logic stays importable and
unit-testable without pulling in torch/ffmpeg.
"""


def fmt_srt_time(seconds: float) -> str:
    h = int(seconds // 3600)
    m = int((seconds % 3600) // 60)
    s = int(seconds % 60)
    ms = int((seconds % 1) * 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def parse_srt_time(ts: str) -> float:
    """'HH:MM:SS,mmm' → seconds."""
    ts = ts.replace(",", ".")
    h, m, s = ts.split(":")
    return int(h) * 3600 + int(m) * 60 + float(s)


def blocks_to_srt_string(blocks: list[dict]) -> str:
    """Build an SRT string from edited subtitle blocks [{start, end, text}, ...]."""
    lines = []
    idx = 1
    for blk in blocks:
        text = (blk.get("text") or "").strip()
        if not text:
            continue
        start = float(blk.get("start", 0.0))
        end = float(blk.get("end", start))
        lines += [
            str(idx),
            f"{fmt_srt_time(start)} --> {fmt_srt_time(end)}",
            text,
            "",
        ]
        idx += 1
    return "\n".join(lines)


def _best_overlap_text(start: float, end: float, others: list[dict]) -> str:
    """Find the other-language block with the largest time overlap; '' if none."""
    best_text, best_overlap = "", 0.0
    for o in others:
        o_start = float(o.get("start", 0.0))
        o_end = float(o.get("end", o_start))
        overlap = min(end, o_end) - max(start, o_start)
        if overlap > best_overlap:
            best_overlap = overlap
            best_text = (o.get("text") or "").strip()
    return best_text


def dual_blocks_to_srt_string(top: list[dict], bottom: list[dict]) -> str:
    """
    Build a 2-line dual SRT. The `top` timeline is the anchor; for each top
    block, the bottom line is the `bottom` block with the most time overlap.
    Line order in each cue: top line first, bottom line second.
    """
    lines = []
    idx = 1
    for blk in top:
        top_text = (blk.get("text") or "").strip()
        start = float(blk.get("start", 0.0))
        end = float(blk.get("end", start))
        bottom_text = _best_overlap_text(start, end, bottom)
        cue = top_text if not bottom_text else f"{top_text}\n{bottom_text}"
        if not cue.strip():
            continue
        lines += [
            str(idx),
            f"{fmt_srt_time(start)} --> {fmt_srt_time(end)}",
            cue,
            "",
        ]
        idx += 1
    return "\n".join(lines)


def srt_string_to_blocks(srt: str) -> list[dict]:
    """Parse an SRT string back into [{start, end, text}] blocks."""
    blocks: list[dict] = []
    for chunk in srt.strip().split("\n\n"):
        rows = [r for r in chunk.splitlines() if r.strip()]
        if len(rows) < 3:
            continue
        time_row = rows[1]
        if "-->" not in time_row:
            continue
        start_s, end_s = [t.strip() for t in time_row.split("-->")]
        text = "\n".join(rows[2:])
        blocks.append({"start": parse_srt_time(start_s), "end": parse_srt_time(end_s), "text": text})
    return blocks
