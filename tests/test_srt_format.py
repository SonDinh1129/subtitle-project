"""Tests for models/srt_format.py — pure SRT string helpers."""

from models.srt_format import (
    fmt_srt_time,
    parse_srt_time,
    blocks_to_srt_string,
    dual_blocks_to_srt_string,
    srt_string_to_blocks,
)


class TestFmtParseTime:
    def test_fmt_basic(self):
        assert fmt_srt_time(0) == "00:00:00,000"
        assert fmt_srt_time(3661.5) == "01:01:01,500"

    def test_roundtrip(self):
        assert parse_srt_time(fmt_srt_time(125.25)) == 125.25


class TestBlocksToSrt:
    def test_basic(self):
        blocks = [
            {"start": 1.0, "end": 2.0, "text": "Hello"},
            {"start": 3.0, "end": 4.0, "text": "World"},
        ]
        out = blocks_to_srt_string(blocks)
        assert "1\n00:00:01,000 --> 00:00:02,000\nHello" in out
        assert "2\n00:00:03,000 --> 00:00:04,000\nWorld" in out

    def test_skips_empty_text(self):
        blocks = [
            {"start": 1.0, "end": 2.0, "text": "  "},
            {"start": 3.0, "end": 4.0, "text": "Kept"},
        ]
        out = blocks_to_srt_string(blocks)
        # Empty block dropped → renumbered to 1.
        assert out.startswith("1\n")
        assert "Kept" in out
        assert out.count("-->") == 1


class TestDualBlocksToSrt:
    def test_overlap_pairs_two_lines(self):
        top = [{"start": 0.0, "end": 2.0, "text": "Xin chào"}]
        bottom = [{"start": 0.1, "end": 1.9, "text": "Hello"}]
        out = dual_blocks_to_srt_string(top, bottom)
        # Top line first, bottom line second, sharing the top timing.
        assert "00:00:00,000 --> 00:00:02,000\nXin chào\nHello" in out

    def test_no_overlap_keeps_top_only(self):
        top = [{"start": 0.0, "end": 2.0, "text": "Xin chào"}]
        bottom = [{"start": 10.0, "end": 12.0, "text": "Hello"}]
        out = dual_blocks_to_srt_string(top, bottom)
        assert "Xin chào" in out
        assert "Hello" not in out

    def test_picks_largest_overlap(self):
        top = [{"start": 0.0, "end": 4.0, "text": "VN"}]
        bottom = [
            {"start": 0.0, "end": 1.0, "text": "small"},
            {"start": 1.0, "end": 3.5, "text": "big"},
        ]
        out = dual_blocks_to_srt_string(top, bottom)
        assert "VN\nbig" in out
        assert "small" not in out

    def test_order_anchors_on_top_timeline(self):
        # Two top cues, one bottom → only overlapping top cue gets the pair.
        top = [
            {"start": 0.0, "end": 1.0, "text": "A"},
            {"start": 5.0, "end": 6.0, "text": "B"},
        ]
        bottom = [{"start": 5.1, "end": 5.9, "text": "b"}]
        out = dual_blocks_to_srt_string(top, bottom)
        assert "A" in out and "B\nb" in out


class TestRoundTripParse:
    def test_srt_string_to_blocks(self):
        srt = blocks_to_srt_string([
            {"start": 1.0, "end": 2.5, "text": "Line one"},
            {"start": 3.0, "end": 4.0, "text": "Line two"},
        ])
        blocks = srt_string_to_blocks(srt)
        assert len(blocks) == 2
        assert blocks[0] == {"start": 1.0, "end": 2.5, "text": "Line one"}
        assert blocks[1]["text"] == "Line two"

    def test_multiline_cue_preserved(self):
        srt = "1\n00:00:00,000 --> 00:00:02,000\nTop\nBottom\n"
        blocks = srt_string_to_blocks(srt)
        assert blocks[0]["text"] == "Top\nBottom"
