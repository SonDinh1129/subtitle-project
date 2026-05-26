"""Tests for models/translation_quality.py"""
from unittest.mock import patch

import pytest

from models.translation_quality import (
    ALLOWED_MODELS,
    DEFAULT_MODEL,
    _build_prompt,
    _escape_for_prompt,
    _estimate_chars,
    _parse_response,
    _safe_issues,
    _safe_score,
    evaluate_translation,
    words_to_sentences,
)


# ─────────────────────────────────────────────────────────────────
# _safe_score
# ─────────────────────────────────────────────────────────────────

class TestSafeScore:
    def test_normal_int(self):
        assert _safe_score(7) == 7

    def test_float_rounds_down(self):
        assert _safe_score(7.9) == 7

    def test_string_digit(self):
        assert _safe_score("8") == 8

    def test_clamp_above_10(self):
        assert _safe_score(11) == 10

    def test_clamp_below_1(self):
        assert _safe_score(0) == 1

    def test_negative(self):
        assert _safe_score(-5) == 1

    def test_none_defaults_to_5(self):
        assert _safe_score(None) == 5

    def test_string_text_defaults_to_5(self):
        assert _safe_score("excellent") == 5

    def test_empty_string_defaults_to_5(self):
        assert _safe_score("") == 5


# ─────────────────────────────────────────────────────────────────
# _safe_issues
# ─────────────────────────────────────────────────────────────────

class TestSafeIssues:
    def test_list_of_strings(self):
        assert _safe_issues(["a", "b"]) == ["a", "b"]

    def test_list_with_non_strings(self):
        assert _safe_issues([1, None, "ok"]) == ["1", "None", "ok"]

    def test_single_string(self):
        assert _safe_issues("missing pronoun") == ["missing pronoun"]

    def test_empty_string_returns_empty(self):
        assert _safe_issues("") == []

    def test_none_returns_empty(self):
        assert _safe_issues(None) == []

    def test_dict_returns_empty(self):
        assert _safe_issues({"key": "val"}) == []

    def test_empty_list(self):
        assert _safe_issues([]) == []


# ─────────────────────────────────────────────────────────────────
# _parse_response
# ─────────────────────────────────────────────────────────────────

class TestParseResponse:
    def _json(self, obj):
        import json
        return json.dumps(obj)

    def test_preferred_key_evaluations(self):
        content = self._json({"evaluations": [{"score": 8}]})
        assert _parse_response(content) == [{"score": 8}]

    def test_fallback_key_results(self):
        content = self._json({"results": [{"score": 7}]})
        assert _parse_response(content) == [{"score": 7}]

    def test_fallback_key_pairs(self):
        content = self._json({"pairs": [{"score": 6}]})
        assert _parse_response(content) == [{"score": 6}]

    def test_bare_list(self):
        content = self._json([{"score": 9}])
        assert _parse_response(content) == [{"score": 9}]

    def test_first_list_value_fallback(self):
        # No preferred key, but contains a list somewhere
        content = self._json({"meta": "x", "data": [{"score": 5}]})
        assert _parse_response(content) == [{"score": 5}]

    def test_no_list_raises_value_error(self):
        content = self._json({"foo": "bar", "baz": 42})
        with pytest.raises(ValueError, match="Unexpected response shape"):
            _parse_response(content)

    def test_invalid_json_raises(self):
        with pytest.raises(Exception):
            _parse_response("not json")

    def test_scores_key_not_matched_as_preferred(self):
        # "scores" was removed from the preferred key list;
        # it should fall through to the "first list value" catch-all
        content = self._json({"scores": [{"score": 8}]})
        result = _parse_response(content)
        assert result == [{"score": 8}]  # still found via catch-all


# ─────────────────────────────────────────────────────────────────
# _escape_for_prompt
# ─────────────────────────────────────────────────────────────────

class TestEscapeForPrompt:
    def test_no_quotes(self):
        assert _escape_for_prompt("hello world") == "hello world"

    def test_double_quote_escaped(self):
        assert _escape_for_prompt('say "hello"') == 'say \\"hello\\"'

    def test_empty_string(self):
        assert _escape_for_prompt("") == ""


# ─────────────────────────────────────────────────────────────────
# _estimate_chars
# ─────────────────────────────────────────────────────────────────

class TestEstimateChars:
    def test_empty_pairs(self):
        # Only overhead
        from models.translation_quality import _PROMPT_OVERHEAD_CHARS
        assert _estimate_chars([]) == _PROMPT_OVERHEAD_CHARS

    def test_single_pair(self):
        from models.translation_quality import _PROMPT_OVERHEAD_CHARS, _PER_PAIR_FORMAT_CHARS
        pairs = [("hello", "xin chào")]
        expected = _PROMPT_OVERHEAD_CHARS + len("hello") + len("xin chào") + _PER_PAIR_FORMAT_CHARS
        assert _estimate_chars(pairs) == expected


# ─────────────────────────────────────────────────────────────────
# words_to_sentences
# ─────────────────────────────────────────────────────────────────

class TestWordsToSentences:
    def test_empty_returns_empty(self):
        assert words_to_sentences([]) == []

    def test_single_word(self):
        words = [{"word": "Hello", "start": 0.0, "end": 0.5}]
        assert words_to_sentences(words) == ["Hello"]

    def test_two_words_same_sentence(self):
        words = [
            {"word": "Hello", "start": 0.0, "end": 0.5},
            {"word": "world", "start": 0.6, "end": 1.0},
        ]
        assert words_to_sentences(words) == ["Hello world"]

    def test_gap_splits_sentence(self):
        words = [
            {"word": "First", "start": 0.0, "end": 0.5},
            {"word": "Second", "start": 2.0, "end": 2.5},  # gap = 1.5s > 0.8
        ]
        assert words_to_sentences(words) == ["First", "Second"]

    def test_gap_exactly_at_threshold_not_split(self):
        # gap = 0.8 is NOT > 0.8, so stays in same sentence
        words = [
            {"word": "A", "start": 0.0, "end": 0.5},
            {"word": "B", "start": 1.3, "end": 1.8},  # gap = 0.8
        ]
        assert words_to_sentences(words) == ["A B"]

    def test_missing_keys_default_to_zero(self):
        # Missing start/end → gap = 0 - 0 = 0, no split; still groups together
        words = [{"word": "X"}, {"word": "Y"}]
        assert words_to_sentences(words) == ["X Y"]

    def test_empty_word_field_skipped(self):
        words = [
            {"word": "Hello", "start": 0.0, "end": 0.5},
            {"word": "", "start": 2.0, "end": 2.5},
            {"word": "world", "start": 5.0, "end": 5.5},
        ]
        result = words_to_sentences(words)
        # Empty word becomes empty string; stripped sentence is still split at gap
        assert "Hello" in result

    def test_custom_gap_threshold(self):
        words = [
            {"word": "A", "start": 0.0, "end": 0.5},
            {"word": "B", "start": 1.0, "end": 1.5},  # gap = 0.5s
        ]
        # With threshold=0.3, gap 0.5 > 0.3 → split
        assert words_to_sentences(words, gap_threshold=0.3) == ["A", "B"]
        # With threshold=0.8 (default), gap 0.5 ≤ 0.8 → same sentence
        assert words_to_sentences(words, gap_threshold=0.8) == ["A B"]

    def test_multiple_sentences(self):
        words = [
            {"word": "Hello", "start": 0.0, "end": 0.5},
            {"word": "world", "start": 0.6, "end": 1.0},
            {"word": "How", "start": 2.5, "end": 2.8},   # gap 1.5 → split
            {"word": "are", "start": 2.9, "end": 3.1},
            {"word": "you", "start": 3.2, "end": 3.5},
        ]
        assert words_to_sentences(words) == ["Hello world", "How are you"]


# ─────────────────────────────────────────────────────────────────
# evaluate_translation (integration, mocked _call_openai)
# ─────────────────────────────────────────────────────────────────

class TestEvaluateTranslation:
    _FAKE_RESULTS = [
        {"score": 9, "issues": [], "comment": "Perfect"},
        {"score": 6, "issues": ["awkward"], "comment": "OK"},
    ]

    def _run(self, en=None, vi=None, model=DEFAULT_MODEL):
        en = en or ["Hello", "Goodbye"]
        vi = vi or ["Xin chào", "Tạm biệt"]
        with patch.dict("os.environ", {"OPENAI_API_KEY": "test-key"}):
            with patch("models.translation_quality._call_openai", return_value=self._FAKE_RESULTS):
                return evaluate_translation(en, vi, model=model)

    def test_basic_report(self):
        report = self._run()
        assert report.total_pairs == 2
        assert report.evaluated_pairs == 2
        assert report.avg_score == 7.5
        assert report.min_score == 6
        assert report.max_score == 9

    def test_to_dict_shape(self):
        d = self._run().to_dict()
        assert "model" in d
        assert "scores" in d
        assert "pairs" in d
        assert d["scores"]["avg"] == 7.5

    def test_invalid_model_raises(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "x"}):
            with pytest.raises(ValueError, match="model must be one of"):
                evaluate_translation(["a"], ["b"], model="gpt-3")

    def test_missing_api_key_raises(self):
        with patch.dict("os.environ", {}, clear=True):
            # Ensure key is absent
            import os
            os.environ.pop("OPENAI_API_KEY", None)
            with pytest.raises(EnvironmentError, match="OPENAI_API_KEY"):
                evaluate_translation(["a"], ["b"])

    def test_empty_pairs_after_filter_raises(self):
        with patch.dict("os.environ", {"OPENAI_API_KEY": "x"}):
            with pytest.raises(ValueError, match="No valid EN/VI pairs"):
                evaluate_translation(["  "], ["  "])

    def test_unequal_lengths_truncated(self):
        # zip truncates to shorter — 1 pair
        report = self._run(en=["Hello", "Extra"], vi=["Xin chào"])
        assert report.total_pairs == 1

    def test_allowed_models(self):
        assert "gpt-4o-mini" in ALLOWED_MODELS
        assert "gpt-4o" in ALLOWED_MODELS
