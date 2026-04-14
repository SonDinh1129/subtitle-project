"""Tests for models/subtitle_optimizer.py"""


def test_smoke():
    """Verify pytest runs."""
    assert 1 + 1 == 2


from models.subtitle_optimizer import SubtitleBlock


class TestSubtitleBlock:
    def test_duration(self):
        b = SubtitleBlock(1, 1.0, 4.0, "Hello world")
        assert b.duration == 3.0

    def test_cps_normal(self):
        b = SubtitleBlock(1, 0.0, 5.0, "Hello world")  # 11 chars / 5s = 2.2
        assert b.cps == 2.2

    def test_cps_zero_duration(self):
        b = SubtitleBlock(1, 1.0, 1.0, "Hello")
        assert b.cps == 0.0

    def test_cps_strips_newlines(self):
        b = SubtitleBlock(1, 0.0, 10.0, "Hello\nworld")  # 10 chars (no \n) / 10s
        assert b.cps == 1.0

    def test_lines(self):
        b = SubtitleBlock(1, 0.0, 1.0, "Line one\nLine two")
        assert b.lines == ["Line one", "Line two"]

    def test_longest_line(self):
        b = SubtitleBlock(1, 0.0, 1.0, "Short\nA longer line")
        assert b.longest_line == 13  # "A longer line"

    def test_longest_line_empty(self):
        b = SubtitleBlock(1, 0.0, 1.0, "")
        assert b.longest_line == 0


from models.subtitle_optimizer import parse_srt, write_srt


class TestSrtParseWrite:
    def test_parse_srt_basic(self):
        content = (
            "1\n"
            "00:00:01,000 --> 00:00:04,000\n"
            "Hello world\n"
            "\n"
            "2\n"
            "00:00:05,000 --> 00:00:08,500\n"
            "Second line\n"
            "\n"
        )
        blocks = parse_srt(content)
        assert len(blocks) == 2
        assert blocks[0].index == 1
        assert blocks[0].start == 1.0
        assert blocks[0].end == 4.0
        assert blocks[0].text == "Hello world"
        assert blocks[1].start == 5.0
        assert blocks[1].end == 8.5

    def test_parse_srt_multiline_text(self):
        content = (
            "1\n"
            "00:00:01,000 --> 00:00:04,000\n"
            "Line one\n"
            "Line two\n"
            "\n"
        )
        blocks = parse_srt(content)
        assert blocks[0].text == "Line one\nLine two"

    def test_parse_srt_windows_line_endings(self):
        content = "1\r\n00:00:01,000 --> 00:00:04,000\r\nHello\r\n\r\n"
        blocks = parse_srt(content)
        assert len(blocks) == 1
        assert blocks[0].text == "Hello"

    def test_parse_srt_with_bom(self):
        content = "\ufeff1\n00:00:01,000 --> 00:00:04,000\nHello\n\n"
        blocks = parse_srt(content)
        assert len(blocks) == 1

    def test_parse_srt_empty(self):
        assert parse_srt("") == []
        assert parse_srt("   ") == []

    def test_write_srt(self):
        blocks = [
            SubtitleBlock(1, 1.0, 4.0, "Hello world"),
            SubtitleBlock(2, 5.0, 8.5, "Second line"),
        ]
        result = write_srt(blocks)
        assert "00:00:01,000 --> 00:00:04,000" in result
        assert "Hello world" in result
        assert "00:00:05,000 --> 00:00:08,500" in result

    def test_roundtrip(self):
        """parse -> write -> parse gives identical blocks."""
        original = (
            "1\n00:00:01,000 --> 00:00:04,000\nHello world\n\n"
            "2\n00:00:05,500 --> 00:00:08,200\nLine one\nLine two\n\n"
        )
        blocks1 = parse_srt(original)
        srt_text = write_srt(blocks1)
        blocks2 = parse_srt(srt_text)
        assert len(blocks1) == len(blocks2)
        for b1, b2 in zip(blocks1, blocks2):
            assert b1.start == b2.start
            assert b1.end == b2.end
            assert b1.text == b2.text

    def test_parse_srt_time(self):
        from models.subtitle_optimizer import _parse_srt_time
        assert _parse_srt_time("01:02:03,456") == 3723.456
        assert _parse_srt_time("00:00:00,000") == 0.0

    def test_fmt_srt_time(self):
        from models.subtitle_optimizer import _fmt_srt_time
        assert _fmt_srt_time(3723.456) == "01:02:03,456"
        assert _fmt_srt_time(0.0) == "00:00:00,000"


from models.subtitle_optimizer import find_best_split, split_block, MAX_DURATION


class TestFindBestSplit:
    def test_prefers_period_near_mid(self):
        text = "Hello world. This is a test sentence here"
        mid = len(text) // 2  # ~20
        pos = find_best_split(text, mid)
        assert text[pos - 1] == '.'  # split after period

    def test_prefers_comma_over_space(self):
        text = "Hello world, this is a test sentence here"
        mid = len(text) // 2
        pos = find_best_split(text, mid)
        assert text[pos - 1] == ','

    def test_fallback_to_space(self):
        text = "Hello world this is a test sentence here"
        mid = len(text) // 2
        pos = find_best_split(text, mid)
        assert text[pos] == ' ' or text[pos - 1] == ' '

    def test_last_resort_mid(self):
        text = "abcdefghijklmnopqrstuvwxyz"  # no spaces or punctuation
        mid = len(text) // 2
        pos = find_best_split(text, mid)
        assert pos == mid


class TestSplitBlock:
    def test_no_split_when_under_max(self):
        b = SubtitleBlock(1, 0.0, 5.0, "Short text")
        result = split_block(b)
        assert len(result) == 1
        assert result[0].text == "Short text"

    def test_splits_long_block(self):
        b = SubtitleBlock(1, 0.0, 14.0, "First part of text. Second part of text")
        result = split_block(b)
        assert len(result) >= 2
        assert all(r.duration <= MAX_DURATION for r in result)

    def test_recursive_very_long(self):
        # 21s block should produce 3+ blocks
        b = SubtitleBlock(1, 0.0, 21.0, "Part one text here. Part two text here. Part three text is here")
        result = split_block(b)
        assert len(result) >= 3
        assert all(r.duration <= MAX_DURATION for r in result)

    def test_duration_proportional_to_chars(self):
        b = SubtitleBlock(1, 0.0, 10.0, "Short. A much longer second part of text")
        result = split_block(b)
        assert len(result) == 2
        # Part with more chars gets more duration
        assert result[1].duration > result[0].duration

    def test_timestamps_continuous(self):
        b = SubtitleBlock(1, 0.0, 14.0, "First part of the text. Second part of text")
        result = split_block(b)
        assert result[0].start == 0.0
        assert result[-1].end == 14.0
        for i in range(len(result) - 1):
            assert result[i].end == result[i + 1].start

    def test_short_text_long_duration(self):
        # 10s block with only 2 chars — should not crash
        b = SubtitleBlock(1, 0.0, 10.0, "OK")
        result = split_block(b)
        assert all(r.duration <= MAX_DURATION for r in result)


from models.subtitle_optimizer import extend_block, MIN_DURATION, MIN_GAP


class TestExtendBlock:
    def test_extend_no_next_block(self):
        b = SubtitleBlock(1, 10.0, 10.3, "Hi")
        result = extend_block(b, None)
        assert not isinstance(result, list)
        assert result.end == 10.0 + MIN_DURATION  # 11.0

    def test_extend_with_room(self):
        b = SubtitleBlock(1, 10.0, 10.3, "Hi")
        next_b = SubtitleBlock(2, 15.0, 18.0, "Next")
        result = extend_block(b, next_b)
        assert not isinstance(result, list)
        assert result.end == 11.0
        assert result.start == 10.0  # unchanged

    def test_merge_when_overlap(self):
        b = SubtitleBlock(1, 10.0, 10.3, "Hi")
        next_b = SubtitleBlock(2, 10.5, 13.0, "Next")
        # target_end = 11.0, available = 10.5 - 0.083 = 10.417 < 11.0 → merge
        result = extend_block(b, next_b)
        assert isinstance(result, list)
        assert len(result) == 1
        assert result[0].start == 10.0
        assert result[0].end == 13.0
        assert "Hi" in result[0].text
        assert "Next" in result[0].text

    def test_merge_normalizes_newlines(self):
        b = SubtitleBlock(1, 10.0, 10.3, "Line1\nLine2")
        next_b = SubtitleBlock(2, 10.5, 13.0, "Line3\nLine4")
        result = extend_block(b, next_b)
        assert isinstance(result, list)
        assert '\n' not in result[0].text  # newlines stripped

    def test_immutable_original_unchanged(self):
        b = SubtitleBlock(1, 10.0, 10.3, "Hi")
        extend_block(b, None)
        assert b.end == 10.3  # original not mutated


from models.subtitle_optimizer import fix_duration


class TestFixDuration:
    def test_no_changes(self):
        blocks = [
            SubtitleBlock(1, 0.0, 3.0, "Normal block"),
            SubtitleBlock(2, 4.0, 7.0, "Another normal"),
        ]
        result, changed = fix_duration(blocks)
        assert not changed
        assert len(result) == 2

    def test_splits_long_block(self):
        blocks = [SubtitleBlock(1, 0.0, 10.0, "First part here. Second part here")]
        result, changed = fix_duration(blocks)
        assert changed
        assert len(result) >= 2
        assert all(b.duration <= MAX_DURATION for b in result)

    def test_extends_short_block(self):
        blocks = [SubtitleBlock(1, 0.0, 0.5, "Hi")]
        result, changed = fix_duration(blocks)
        assert changed
        assert result[0].duration >= MIN_DURATION

    def test_merge_short_with_next(self):
        blocks = [
            SubtitleBlock(1, 10.0, 10.3, "Hi"),
            SubtitleBlock(2, 10.4, 13.0, "Next block"),
        ]
        result, changed = fix_duration(blocks)
        assert changed
        # Merged into one block — skip_next ensures next isn't double-processed
        assert len(result) == 1
        assert result[0].start == 10.0
        assert result[0].end == 13.0

    def test_skip_next_after_merge(self):
        blocks = [
            SubtitleBlock(1, 10.0, 10.3, "Hi"),      # < MIN_DURATION → merge with next
            SubtitleBlock(2, 10.4, 13.0, "Next"),     # absorbed by merge
            SubtitleBlock(3, 14.0, 17.0, "Third"),    # should pass through normally
        ]
        result, changed = fix_duration(blocks)
        assert changed
        assert len(result) == 2  # merged(1+2) + 3
        assert result[1].text == "Third"

    def test_mixed_violations(self):
        blocks = [
            SubtitleBlock(1, 0.0, 10.0, "Long text here. Split needed text"),  # > 7s
            SubtitleBlock(2, 11.0, 14.0, "Normal"),
            SubtitleBlock(3, 15.0, 15.3, "Short"),   # < 1s
        ]
        result, changed = fix_duration(blocks)
        assert changed
        assert all(b.duration <= MAX_DURATION for b in result)


from models.subtitle_optimizer import wrap_text, MAX_CPL_VI


class TestWrapText:
    def test_short_text_single_line(self):
        result = wrap_text("Short text", MAX_CPL_VI)
        assert result == ["Short text"]

    def test_balanced_two_lines_top_heavy(self):
        # ~60 chars → 2 lines, line1 >= line2
        text = "This is the first half of text and this is the second half"
        result = wrap_text(text, MAX_CPL_VI)
        assert len(result) == 2
        assert len(result[0]) >= len(result[1])  # top-heavy

    def test_respects_max_cpl(self):
        text = "Word " * 20  # 100 chars
        result = wrap_text(text.strip(), MAX_CPL_VI)
        assert all(len(line) <= MAX_CPL_VI for line in result)

    def test_greedy_fallback_when_balanced_fails(self):
        # Text too long for 2 balanced lines
        text = "Word " * 30  # 150 chars
        result = wrap_text(text.strip(), MAX_CPL_VI)
        assert len(result) > 2
        assert all(len(line) <= MAX_CPL_VI for line in result)

    def test_empty_text(self):
        result = wrap_text("", MAX_CPL_VI)
        assert result == ['']

    def test_single_long_word(self):
        # One word > MAX_CPL — greedy wrap puts it on its own line
        text = "a" * 60
        result = wrap_text(text, MAX_CPL_VI)
        assert len(result) == 1  # single word, can't split

    def test_vietnamese_text(self):
        text = "Xin chào các bạn, hôm nay chúng ta sẽ học về lập trình Python"
        result = wrap_text(text, MAX_CPL_VI)
        assert all(len(line) <= MAX_CPL_VI for line in result)


from models.subtitle_optimizer import fix_cpl, MAX_LINES


class TestFixCpl:
    def test_no_changes_short_text(self):
        blocks = [SubtitleBlock(1, 0.0, 3.0, "Short text")]
        result, changed = fix_cpl(blocks)
        assert not changed
        assert result[0].text == "Short text"

    def test_flattens_unnecessary_newline(self):
        blocks = [SubtitleBlock(1, 0.0, 3.0, "Short\ntext")]  # 10 chars, fits in 1 line
        result, changed = fix_cpl(blocks)
        assert changed
        assert result[0].text == "Short text"

    def test_wraps_long_line(self):
        text = "This is a fairly long subtitle text that definitely exceeds forty seven characters limit"
        blocks = [SubtitleBlock(1, 0.0, 5.0, text)]
        result, changed = fix_cpl(blocks)
        assert changed
        assert '\n' in result[0].text
        for line in result[0].lines:
            assert len(line) <= MAX_CPL_VI

    def test_splits_when_exceeds_max_lines(self):
        # Text that needs >2 lines
        text = "Word " * 40  # 200 chars → needs ~5 lines at 47 CPL
        blocks = [SubtitleBlock(1, 0.0, 10.0, text.strip())]
        result, changed = fix_cpl(blocks)
        assert changed
        assert len(result) > 1  # split into multiple blocks
        for b in result:
            assert len(b.lines) <= MAX_LINES

    def test_removes_empty_blocks(self):
        blocks = [
            SubtitleBlock(1, 0.0, 3.0, ""),
            SubtitleBlock(2, 4.0, 7.0, "Normal text"),
        ]
        result, changed = fix_cpl(blocks)
        assert changed
        assert len(result) == 1
        assert result[0].text == "Normal text"

    def test_split_blocks_have_continuous_timestamps(self):
        text = "Word " * 40
        blocks = [SubtitleBlock(1, 0.0, 10.0, text.strip())]
        result, _ = fix_cpl(blocks)
        assert result[0].start == 0.0
        assert result[-1].end == 10.0

    def test_unchanged_returns_false(self):
        blocks = [SubtitleBlock(1, 0.0, 3.0, "Short text")]
        _, changed = fix_cpl(blocks)
        assert not changed


from models.subtitle_optimizer import fix_cps, MAX_CPS


class TestFixCps:
    def test_no_changes_under_limit(self):
        # 10 chars / 5s = 2.0 CPS — well under 17
        blocks = [SubtitleBlock(1, 0.0, 5.0, "Short text")]
        result, changed = fix_cps(blocks)
        assert not changed

    def test_extend_when_room(self):
        # 50 chars / 2s = 25 CPS → needs 50/17 ≈ 2.94s
        text = "A" * 50
        blocks = [
            SubtitleBlock(1, 0.0, 2.0, text),
            SubtitleBlock(2, 10.0, 13.0, "Next"),
        ]
        result, changed = fix_cps(blocks)
        assert changed
        assert result[0].cps <= MAX_CPS + 0.1  # small float tolerance
        assert result[0].start == 0.0  # start unchanged

    def test_extend_respects_gap(self):
        # 50 chars / 2s = 25 CPS, but next block starts at 3.0
        # needed_duration = 50/17 = 2.94, target_end = 2.94
        # max_end = 3.0 - 0.083 = 2.917 < 2.94 → can't extend enough → split
        text = "A" * 50
        blocks = [
            SubtitleBlock(1, 0.0, 2.0, text),
            SubtitleBlock(2, 3.0, 6.0, "Next"),
        ]
        result, changed = fix_cps(blocks)
        assert changed
        assert len(result) >= 3  # block 1 split + block 2

    def test_extend_last_block_freely(self):
        # Last block, no next → can extend up to MAX_DURATION
        text = "A" * 50
        blocks = [SubtitleBlock(1, 0.0, 2.0, text)]
        result, changed = fix_cps(blocks)
        assert changed
        assert result[0].cps <= MAX_CPS + 0.1

    def test_deadlock_accepts_violation(self):
        # 30 chars / 1.2s = 25 CPS → needs 1.76s
        # Can't extend (next too close), split would create < 1s blocks
        text = "A" * 30
        blocks = [
            SubtitleBlock(1, 0.0, 1.2, text),
            SubtitleBlock(2, 1.3, 4.0, "Next"),
        ]
        result, changed = fix_cps(blocks)
        # Should keep original — CPS violation accepted, no changes made
        assert not changed
        assert result[0].text == text
        assert result[0].duration == 1.2

    def test_extend_capped_by_max_duration(self):
        # 200 chars / 5s = 40 CPS → needs 200/17 ≈ 11.76s → exceeds MAX_DURATION → split
        text = "A" * 200
        blocks = [SubtitleBlock(1, 0.0, 5.0, text)]
        result, changed = fix_cps(blocks)
        assert changed
        assert len(result) >= 2


from models.subtitle_optimizer import fix_gap


class TestFixGap:
    def test_single_block(self):
        blocks = [SubtitleBlock(1, 0.0, 3.0, "Only one")]
        result = fix_gap(blocks)
        assert len(result) == 1

    def test_no_changes_sufficient_gap(self):
        blocks = [
            SubtitleBlock(1, 0.0, 3.0, "First"),
            SubtitleBlock(2, 4.0, 7.0, "Second"),
        ]
        result = fix_gap(blocks)
        assert len(result) == 2
        assert result[0].end == 3.0  # unchanged

    def test_shrinks_prev_end(self):
        blocks = [
            SubtitleBlock(1, 0.0, 3.95, "First block text"),
            SubtitleBlock(2, 4.0, 7.0, "Second"),
        ]
        # gap = 4.0 - 3.95 = 0.05 < 0.083 → shrink prev.end
        result = fix_gap(blocks)
        assert len(result) == 2
        gap = result[1].start - result[0].end
        assert gap >= MIN_GAP - 0.001  # float tolerance

    def test_merges_when_shrink_too_much(self):
        blocks = [
            SubtitleBlock(1, 3.0, 3.95, "Hi"),     # duration=0.95, already near MIN_DURATION
            SubtitleBlock(2, 4.0, 7.0, "Second"),   # gap=0.05 < MIN_GAP
        ]
        # shrink prev.end to 4.0-0.083=3.917 → new duration=0.917 < MIN_DURATION → merge
        result = fix_gap(blocks)
        assert len(result) == 1
        assert result[0].start == 3.0
        assert result[0].end == 7.0

    def test_overlap_handled(self):
        blocks = [
            SubtitleBlock(1, 0.0, 5.0, "First block"),
            SubtitleBlock(2, 4.0, 7.0, "Overlapping"),
        ]
        # gap = 4.0 - 5.0 = -1.0 → overlap
        result = fix_gap(blocks)
        # Should either shrink or merge — no overlap in result
        for i in range(len(result) - 1):
            assert result[i + 1].start - result[i].end >= MIN_GAP - 0.001

    def test_merged_text_gets_cpl_fix(self):
        long_text = "A " * 30  # 60 chars → needs wrapping after merge
        blocks = [
            SubtitleBlock(1, 3.0, 3.95, long_text.strip()),
            SubtitleBlock(2, 4.0, 7.0, "Second part here"),
        ]
        result = fix_gap(blocks)
        assert len(result) == 1
        # Merged block should have been wrapped
        for line in result[0].lines:
            assert len(line) <= MAX_CPL_VI

    def test_empty_list(self):
        result = fix_gap([])
        assert result == []
