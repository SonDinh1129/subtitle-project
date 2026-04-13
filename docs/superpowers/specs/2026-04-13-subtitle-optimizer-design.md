# Subtitle Post-Processing Optimizer — Design Spec

**Date:** 2026-04-13
**Status:** Draft
**Scope:** Vietnamese SRT post-processing engine enforcing broadcast/Netflix subtitle standards

---

## 1. Overview

SubAI currently generates Vietnamese subtitles via Whisper ASR + VinAI Translate, but does not enforce industry subtitle standards after translation. This spec defines a post-processing optimizer that ensures Vietnamese SRT output meets broadcast/Netflix quality standards.

**Key decisions from brainstorming:**

- **Target standard:** Broadcast/Netflix strict
- **Scope:** Vietnamese SRT only (triggered manually, premium feature)
- **CPS fix strategy:** Extend duration first, fallback split block
- **Pipeline order:** Duration → CPL → CPS → Gap (with rationale below)
- **Architecture:** Single-pass linear pipeline with convergence loop (Approach A)

---

## 2. Standards Enforced

| Rule | Value | Notes |
|------|-------|-------|
| MAX_CPS | 17.0 | Netflix standard reading speed |
| MAX_CPL_VI | 47 | Vietnamese (Latin + diacritics, ~10-20% longer than EN) |
| MAX_LINES | 2 | Max 2 lines per subtitle block |
| MIN_DURATION | 1.0s | Minimum display time |
| MAX_DURATION | 7.0s | Maximum display time |
| MIN_GAP | 0.083s | ~2 frames @ 24fps, prevents flash |

---

## 3. Architecture

### 3.1 Module

New file: `models/subtitle_optimizer.py` — separate from `subtitle_model.py` (single responsibility).

### 3.2 Data Structure

```python
from dataclasses import dataclass, replace

@dataclass(frozen=False)
class SubtitleBlock:
    index: int           # SRT sequence number
    start: float         # Start timestamp (seconds)
    end: float           # End timestamp (seconds)
    text: str            # Content (may contain \n for multi-line)

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
```

Dataclass is mutable (`frozen=False`) but all modifications go through `dataclasses.replace()` to create new instances — avoids in-place mutation for easier debugging and traceability.

### 3.3 Pipeline Entry Point

```python
import logging

logger = logging.getLogger(__name__)

def optimize_subtitles(blocks: list[SubtitleBlock]) -> list[SubtitleBlock]:
    """Main entry — run pipeline loop until convergence or max 3 iterations."""
    for iteration in range(3):
        blocks, d_changed = fix_duration(blocks)
        blocks, c_changed = fix_cpl(blocks, max_cpl=MAX_CPL_VI)
        blocks, s_changed = fix_cps(blocks)
        blocks = fix_gap(blocks)  # always runs — no convergence check needed
        if not (d_changed or c_changed or s_changed):
            break

    # Re-index
    for i, block in enumerate(blocks, 1):
        block.index = i

    # Log any remaining violations
    for block in blocks:
        if block.cps > MAX_CPS:
            logger.warning(
                f"Block {block.index}: CPS={block.cps:.1f} > {MAX_CPS} — could not fix"
            )

    return blocks
```

### 3.4 Pipeline Order Rationale

**Duration → CPL → CPS → Gap**

1. **Duration first** — decides block count. Splitting a 10s block into two 5s blocks changes all context for subsequent steps.
2. **CPL before CPS** — text wrapping affects readability layout. CPL does not change duration, only layout. CPS calculation is only meaningful after knowing how text is divided into lines.
3. **CPS after Duration+CPL** — CPS fix may adjust duration again (extend or split). Both affect Gap, so CPS must run before Gap.
4. **Gap last** — gap is a relationship between blocks. Can only fix after all blocks have correct durations.

**Edge case:** When Duration split creates new blocks, they are inserted in-place and continue forward iteration — no pipeline restart needed because split parts are always shorter than the original, so they cannot violate Duration again.

---

## 4. Pipeline Steps

### 4.1 fix_duration — Split long blocks, extend short blocks

```python
def fix_duration(blocks: list[SubtitleBlock]) -> tuple[list[SubtitleBlock], bool]:
    result = []
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
                # next_block absorbed into merge — skip it
                result.extend(extended)
                skip_next = True
            else:
                result.append(extended)
            changed = True
        else:
            result.append(block)

    return result, changed
```

#### split_block (recursive)

```python
def split_block(block: SubtitleBlock) -> list[SubtitleBlock]:
    """Split block > MAX_DURATION into 2+ blocks recursively.

    Strategy for split point:
    1. Prefer sentence-ending punctuation (. ? ! ; , —)
    2. Fallback: whitespace nearest to midpoint
    3. Last resort: midpoint
    
    Timing: allocate duration proportional to character count per part.
    Recursive: each part is checked again, ensuring all results <= MAX_DURATION.
    """
    if block.duration <= MAX_DURATION:
        return [block]

    text = block.text.replace('\n', ' ')
    mid = len(text) // 2
    split_pos = find_best_split(text, mid)

    part1_text = text[:split_pos].strip()
    part2_text = text[split_pos:].strip()

    # Allocate duration proportional to character count
    ratio = len(part1_text) / len(text) if len(text) > 0 else 0.5
    split_time = block.start + block.duration * ratio

    part1 = SubtitleBlock(0, block.start, round(split_time, 3), part1_text)
    part2 = SubtitleBlock(0, round(split_time, 3), block.end, part2_text)

    # Recursive — each part checked again
    return split_block(part1) + split_block(part2)
```

#### find_best_split

```python
def find_best_split(text: str, mid: int) -> int:
    """Find best split position near mid."""
    window = max(10, len(text) // 5)
    search_start = max(0, mid - window)
    search_end = min(len(text), mid + window)

    # Priority: sentence-ending punctuation nearest to mid
    for punct in ['.', '?', '!', ';', ',', '\u2014']:  # \u2014 = em dash
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

    # Fallback: whitespace nearest to mid
    for offset in range(window):
        if mid + offset < len(text) and text[mid + offset] == ' ':
            return mid + offset
        if mid - offset >= 0 and text[mid - offset] == ' ':
            return mid - offset

    # Last resort
    return mid
```

#### extend_block (immutable, micro-check gap)

```python
def extend_block(
    block: SubtitleBlock, next_block: SubtitleBlock | None
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
        # Merge — normalize text, strip internal newlines
        merged_text = ' '.join([
            block.text.replace('\n', ' '),
            next_block.text.replace('\n', ' ')
        ])
        # Merged block may violate Duration/CPL/CPS — caught by next iteration
        return [SubtitleBlock(0, block.start, next_block.end, merged_text)]
```

### 4.2 fix_cpl — Wrap text to character/line limits

```python
from dataclasses import replace

def fix_cpl(
    blocks: list[SubtitleBlock], max_cpl: int = MAX_CPL_VI
) -> tuple[list[SubtitleBlock], bool]:
    """Wrap text so each line <= max_cpl characters, max MAX_LINES lines.

    If text cannot fit in MAX_LINES x max_cpl, split into multiple blocks.
    Empty-text blocks are removed.
    """
    result = []
    changed = False

    for block in blocks:
        flat_text = block.text.replace('\n', ' ')

        # Remove empty blocks
        if not flat_text.strip():
            changed = True
            continue

        # Fits in 1 line
        if len(flat_text) <= max_cpl:
            if block.text != flat_text:
                result.append(replace(block, text=flat_text))
                changed = True
            else:
                result.append(block)
            continue

        # Wrap into multiple lines
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
            splits = split_block_by_text(block, lines, max_cpl)
            result.extend(splits)
            changed = True

    return result, changed
```

#### wrap_text (top-heavy balanced)

```python
def wrap_text(text: str, max_cpl: int) -> list[str]:
    """Greedy wrap, prefer balanced top-heavy lines.

    Top-heavy = line 1 >= line 2 in length.
    Rationale: subtitles display at bottom of screen — shorter bottom line
    blocks less of the video.
    
    Note: greedy wrap naturally creates top-heavy output (fills from left),
    matching bottom-screen subtitle convention.
    """
    words = text.split()
    if not words:
        return ['']

    # Try balanced 2-line split first
    total = len(text)
    if total <= max_cpl * 2:
        best = _find_balanced_split(words, max_cpl)
        if best:
            return best

    # Fallback: greedy wrap
    lines, current = [], ''
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
    cumulative = []
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
```

#### split_block_by_text

```python
def split_block_by_text(
    block: SubtitleBlock, lines: list[str], max_cpl: int
) -> list[SubtitleBlock]:
    """Split block when text needs > MAX_LINES lines.

    Groups lines into chunks of MAX_LINES, allocates duration proportional
    to character count. New blocks may have duration < MIN_DURATION —
    caught by fix_duration in next iteration.
    """
    groups = []
    for i in range(0, len(lines), MAX_LINES):
        group_lines = lines[i:i + MAX_LINES]
        groups.append('\n'.join(group_lines))

    total_chars = sum(len(g.replace('\n', '')) for g in groups)
    blocks_out = []
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
```

### 4.3 fix_cps — Ensure reading speed <= 17 CPS

```python
def fix_cps(blocks: list[SubtitleBlock]) -> tuple[list[SubtitleBlock], bool]:
    """Ensure each block has CPS <= MAX_CPS.

    Strategy (user-specified priority):
    1. Extend duration (if gap available after block)
    2. Fallback: split block into 2
    
    Dead-lock case: if split would create blocks < MIN_DURATION,
    accept the CPS violation — no better option exists.
    """
    result = []
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

        # Note: we check blocks[i+1].start (original), not result[-1].end.
        # This is safe because extend_end only affects forward direction,
        # never conflicts with already-processed blocks behind us.
        if target_end <= max_end and needed_duration <= MAX_DURATION:
            result.append(replace(block, end=round(target_end, 3)))
            changed = True
            continue

        # Strategy B: split block (reuses recursive split_block from Section 4.1)
        splits = split_block(block)

        # Dead-lock guard: if split creates blocks < MIN_DURATION, accept CPS violation
        if any(s.duration < MIN_DURATION for s in splits):
            result.append(block)  # keep original, CPS violation accepted
            logger.warning(
                f"Block {block.index}: CPS={block.cps:.1f} — cannot fix without "
                f"creating blocks < {MIN_DURATION}s, accepting violation"
            )
        else:
            result.extend(splits)
            changed = True

    return result, changed
```

### 4.4 fix_gap — Ensure minimum gap between blocks

```python
def fix_gap(blocks: list[SubtitleBlock]) -> list[SubtitleBlock]:
    """Ensure gap between consecutive blocks >= MIN_GAP (83ms).

    No changed flag returned — always runs, does not contribute to
    convergence check. Gap fix may increase CPS of previous block
    (by shortening its duration). This is an accepted trade-off:
    gap correctness > CPS in a single pass. fix_cps catches it
    in the next iteration.

    Strategy:
    - gap < MIN_GAP: shrink prev.end
    - shrink would create prev.duration < MIN_DURATION: merge blocks
    """
    if len(blocks) <= 1:
        return blocks

    result = [blocks[0]]

    for i in range(1, len(blocks)):
        prev = result[-1]
        curr = blocks[i]
        gap = curr.start - prev.end

        if gap < 0:
            logger.warning(
                f"Block {i-1} -> {i}: overlap {abs(gap):.3f}s"
            )

        if gap >= MIN_GAP:
            result.append(curr)
            continue

        # Gap too small — shrink prev.end
        new_prev_end = curr.start - MIN_GAP

        if new_prev_end - prev.start >= MIN_DURATION:
            result[-1] = replace(prev, end=round(new_prev_end, 3))
            result.append(curr)
        else:
            # Shrinking would make prev < MIN_DURATION — merge
            merged_text = ' '.join([
                prev.text.replace('\n', ' '),
                curr.text.replace('\n', ' ')
            ])
            merged_block = SubtitleBlock(0, prev.start, curr.end, merged_text)

            # Inline CPL fix for merged block — defensive, avoids edge case
            # where merge happens on last iteration and CPL violation persists
            flat = merged_block.text
            lines = wrap_text(flat, MAX_CPL_VI)
            if len(lines) <= MAX_LINES:
                merged_block = replace(merged_block, text='\n'.join(lines))

            # curr absorbed into prev — not appended separately
            # result[-1] now spans prev.start -> curr.end
            result[-1] = merged_block

    return result
```

---

## 5. Integration

### 5.1 API Endpoint

New route in `subtitle_controller.py`:

```python
from pathlib import Path

@subtitle_bp.route('/api/jobs/<job_id>/optimize', methods=['POST'])
@require_auth
@require_premium
def optimize_job_subtitles(job_id):
    """Premium feature: optimize Vietnamese SRT to broadcast standards."""
    job = get_job(job_id)
    if not job:
        return jsonify(error="Job not found"), 404

    # Ownership check
    if job["user_id"] != g.user_id:
        return jsonify(error="Forbidden"), 403

    vi_srt_path = job.get('vi_srt_path')
    if not vi_srt_path or not os.path.exists(vi_srt_path):
        return jsonify(error="Vietnamese SRT not found"), 404

    with open(vi_srt_path, 'r', encoding='utf-8') as f:
        content = f.read()

    blocks = parse_srt(content)
    optimized = optimize_subtitles(blocks)
    result_srt = write_srt(optimized)

    # Write optimized file (safe filename via pathlib)
    p = Path(vi_srt_path)
    opt_path = str(p.with_stem(p.stem + '_optimized'))
    with open(opt_path, 'w', encoding='utf-8') as f:
        f.write(result_srt)

    update_job(job_id, vi_srt_optimized_path=opt_path)

    return jsonify(
        message="Optimized successfully",
        path=opt_path,
        stats=get_optimization_stats(blocks, optimized)
    )
```

### 5.2 SRT Parser & Writer

```python
import re

def parse_srt(content: str) -> list[SubtitleBlock]:
    """Parse SRT string to list of SubtitleBlock."""
    content = content.replace('\r\n', '\n').replace('\r', '\n')
    pattern = re.compile(
        r'(\d+)\s*\n'
        r'(\d{2}:\d{2}:\d{2},\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2},\d{3})\s*\n'
        r'(.*?)(?=\n\n|\Z)',
        re.DOTALL
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
```

### 5.3 Optimization Stats

```python
def get_optimization_stats(
    before: list[SubtitleBlock], after: list[SubtitleBlock]
) -> dict:
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
```

---

## 6. Known Limitations & Accepted Trade-offs

1. **CPS dead-lock:** When a block has very dense text and short duration, splitting would create blocks < MIN_DURATION. In this case, the CPS violation is accepted and logged as a warning.

2. **Last-iteration merge in fix_gap:** If merge happens on iteration 3 (final), the merged block does not go through fix_duration or fix_cps again. Mitigated by inline CPL fix in fix_gap. CPS/Duration violations from last-iteration merges are extremely rare in practice.

3. **Vietnamese text length:** Vietnamese translations are typically 10-20% longer than English source. MAX_CPL_VI=47 accommodates this while staying within readable limits.

4. **Word-level timing lost:** The optimizer works on block-level timing, not word-level. When splitting blocks, duration is allocated proportionally by character count — not by original word timestamps. This is acceptable because the optimizer runs on translated Vietnamese text which has different word boundaries than the English source.
