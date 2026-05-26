"""
translation_quality.py — Translation Quality Evaluator
───────────────────────────────────────────────────────
Gửi toàn bộ cặp (EN, VI) lên ChatGPT REST API để đánh giá chất lượng dịch.
Không cần reference translation — LLM-as-judge approach.

Yêu cầu:
    OPENAI_API_KEY env var
    Không cần package ngoài (dùng urllib.request + json stdlib)
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass

OPENAI_CHAT_URL = "https://api.openai.com/v1/chat/completions"
DEFAULT_MODEL = "gpt-4o-mini"
ALLOWED_MODELS = frozenset({"gpt-4o-mini", "gpt-4o"})

# Token budget: ~128k context limit minus response headroom.
# Prompt template ≈ 600 chars, per-pair formatting ≈ 20 chars overhead.
_PROMPT_OVERHEAD_CHARS = 600
_PER_PAIR_FORMAT_CHARS = 20
MAX_TOKENS_SAFETY = 100_000   # chars / 4 ≈ tokens

REQUEST_TIMEOUT = 30  # giây — 30s đủ cho gpt-4o-mini, giảm tránh block worker quá lâu


@dataclass
class PairScore:
    en: str
    vi: str
    score: int          # 1–10 (clamped)
    issues: list[str]   # danh sách lỗi cụ thể (có thể rỗng)
    comment: str        # nhận xét ngắn


@dataclass
class TranslationQualityReport:
    model: str
    total_pairs: int
    evaluated_pairs: int      # có thể < total_pairs nếu bị cắt do token limit
    avg_score: float
    min_score: int
    max_score: int
    pairs: list[PairScore]

    def to_dict(self) -> dict:
        return {
            "model": self.model,
            "total_pairs": self.total_pairs,
            "evaluated_pairs": self.evaluated_pairs,
            "scores": {
                "avg": round(self.avg_score, 2),
                "min": self.min_score,
                "max": self.max_score,
            },
            "pairs": [
                {
                    "en": p.en,
                    "vi": p.vi,
                    "score": p.score,
                    "issues": p.issues,
                    "comment": p.comment,
                }
                for p in self.pairs
            ],
        }


def _escape_for_prompt(text: str) -> str:
    """Escape double-quotes so subtitle text doesn't break the prompt format."""
    return text.replace('"', '\\"')


def _build_prompt(pairs: list[tuple[str, str]]) -> str:
    numbered = "\n".join(
        f'{i + 1}. EN: "{_escape_for_prompt(en)}"\n   VI: "{_escape_for_prompt(vi)}"'
        for i, (en, vi) in enumerate(pairs)
    )
    return (
        "You are a professional translator evaluating English→Vietnamese subtitle translations.\n"
        "Rate each pair on a scale of 1–10 (10 = perfect).\n\n"
        "Scoring guide:\n"
        "  9-10: Accurate meaning, natural Vietnamese, correct subtitle style\n"
        "  7-8:  Minor wording issues, meaning preserved\n"
        "  5-6:  Meaning partially lost or awkward phrasing\n"
        "  3-4:  Significant errors, confusing translation\n"
        "  1-2:  Wrong meaning or untranslated\n\n"
        "Respond with a JSON object in this exact format (no markdown fences):\n"
        '{"evaluations": [\n'
        '  {"score": <int 1-10>, "issues": ["<issue>", ...], "comment": "<one sentence>"},\n'
        '  ...\n'
        "]}\n\n"
        f"Pairs to evaluate:\n{numbered}"
    )


def _parse_response(content: str) -> list[dict]:
    """Parse ChatGPT response — expects {"evaluations": [...]} but handles variations."""
    parsed = json.loads(content)

    if isinstance(parsed, list):
        return parsed

    # Preferred key first, then fallbacks
    for key in ("evaluations", "results", "pairs"):
        if key in parsed and isinstance(parsed[key], list):
            return parsed[key]

    # Last resort: first list value found
    for v in parsed.values():
        if isinstance(v, list):
            return v

    raise ValueError(f"Unexpected response shape from ChatGPT: {list(parsed.keys())}")


def _safe_score(raw) -> int:
    """Convert raw score value to clamped int 1–10; default 5 on failure."""
    try:
        return max(1, min(10, int(float(raw))))
    except (TypeError, ValueError):
        return 5


def _safe_issues(raw) -> list[str]:
    """Coerce issues field to list[str] regardless of what the model returned."""
    if isinstance(raw, list):
        return [str(x) for x in raw]
    if isinstance(raw, str) and raw:
        return [raw]
    return []


def words_to_sentences(words: list[dict], gap_threshold: float = 0.8) -> list[str]:
    """Group word-level dicts into sentences split by silence gaps >= gap_threshold seconds.

    Each word dict must have keys: "word" (str), "start" (float), "end" (float).
    Missing keys default to empty string / 0.0 without raising.
    """
    if not words:
        return []
    sentences, buf = [], []
    for i, w in enumerate(words):
        buf.append(w.get("word", ""))
        gap = words[i + 1].get("start", 0) - w.get("end", 0) if i + 1 < len(words) else 9999
        if gap > gap_threshold or i + 1 == len(words):
            text = " ".join(buf).strip()
            if text:
                sentences.append(text)
            buf = []
    return sentences


def _estimate_chars(pairs: list[tuple[str, str]]) -> int:
    return _PROMPT_OVERHEAD_CHARS + sum(
        len(en) + len(vi) + _PER_PAIR_FORMAT_CHARS for en, vi in pairs
    )


def _call_openai(prompt: str, model: str) -> list[dict]:
    """Call OpenAI chat completions. Reads API key directly from env (not passed as arg)."""
    api_key = os.environ["OPENAI_API_KEY"]  # KeyError caught by caller

    body = json.dumps({
        "model": model,
        "messages": [{"role": "user", "content": prompt}],
        "temperature": 0,
        "max_tokens": 4096,
        "response_format": {"type": "json_object"},
    }).encode()

    req = urllib.request.Request(
        OPENAI_CHAT_URL,
        data=body,
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {api_key}",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=REQUEST_TIMEOUT) as resp:
        data = json.loads(resp.read().decode())

    content = data["choices"][0]["message"]["content"]
    return _parse_response(content)


def evaluate_translation(
    en_texts: list[str],
    vi_texts: list[str],
    model: str = DEFAULT_MODEL,
) -> TranslationQualityReport:
    """
    Đánh giá chất lượng dịch EN→VI qua ChatGPT REST API.
    Gửi toàn bộ cặp EN/VI, tự cắt nếu vượt token limit (~100k tokens).

    Args:
        en_texts: Danh sách câu tiếng Anh
        vi_texts: Danh sách câu tiếng Việt tương ứng
        model:    OpenAI model ID — phải nằm trong ALLOWED_MODELS

    Returns:
        TranslationQualityReport

    Raises:
        EnvironmentError: Nếu OPENAI_API_KEY chưa set
        ValueError:       Nếu model không hợp lệ, không có cặp nào, hoặc response lỗi
        urllib.error.HTTPError: Nếu OpenAI trả HTTP error (429, 5xx, ...)
    """
    if not os.environ.get("OPENAI_API_KEY", "").strip():
        raise EnvironmentError("OPENAI_API_KEY environment variable is not set")

    if model not in ALLOWED_MODELS:
        raise ValueError(f"model must be one of: {sorted(ALLOWED_MODELS)}")

    # Lọc cặp rỗng; zip() đã xử lý độ dài không bằng nhau (truncate phần dài hơn)
    pairs_all = [
        (en.strip(), vi.strip())
        for en, vi in zip(en_texts, vi_texts)
        if en.strip() and vi.strip()
    ]
    if not pairs_all:
        raise ValueError("No valid EN/VI pairs provided")

    total_pairs = len(pairs_all)

    # Cắt tuyến tính nếu vượt token limit
    pairs = pairs_all
    if _estimate_chars(pairs_all) > MAX_TOKENS_SAFETY * 4:
        avg_chars = _estimate_chars(pairs_all) / len(pairs_all)
        max_pairs = max(1, int(MAX_TOKENS_SAFETY * 4 / avg_chars))
        pairs = pairs_all[:max_pairs]

    prompt = _build_prompt(pairs)
    raw_results = _call_openai(prompt, model)

    # Zip truncates gracefully if model returns fewer/more items than expected
    scored_pairs: list[PairScore] = [
        PairScore(
            en=en,
            vi=vi,
            score=_safe_score(r.get("score")),
            issues=_safe_issues(r.get("issues")),
            comment=str(r.get("comment", "") or ""),
        )
        for (en, vi), r in zip(pairs, raw_results)
    ]

    if not scored_pairs:
        raise ValueError("ChatGPT returned no evaluations")

    scores = [p.score for p in scored_pairs]
    return TranslationQualityReport(
        model=model,
        total_pairs=total_pairs,
        evaluated_pairs=len(scored_pairs),
        avg_score=sum(scores) / len(scores),
        min_score=min(scores),
        max_score=max(scores),
        pairs=scored_pairs,
    )
