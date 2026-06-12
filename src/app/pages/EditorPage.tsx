import { useState, useRef, useEffect, useMemo, useCallback } from "react";
import { Navigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import {
  wordsToSubtitles,
  exportVideo as exportVideoApi,
  pollExportUntilDone,
  openRealtimeStream,
  getVideoUrl,
  type Word,
  type ExportResolution,
  type RealtimeStreamEvent,
} from "../../lib/api";
import {
  Play,
  Pause,
  Edit3,
  Type,
  Palette,
  AlignCenter,
  AlignStartVertical,
  ChevronDown,
  Plus,
  Trash2,
  Clock,
  Check,
  Volume1,
  Volume2,
  VolumeX,
  Maximize2,
  FileText,
  Video,
  Save,
  Undo,
  Redo,
  Search,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { ImageWithFallback } from "../components/figma/ImageWithFallback";

interface Subtitle {
  id: string;
  startTime: number;
  endTime: number;
  text: string;
  selected: boolean;
}

interface CaptionSegment {
  start: number;
  end: number;
  words: Word[];
  text: string;
  lineBreakIndex: number;
}

type SubtitleDisplayMode =
  | "off"
  | "en-only"
  | "vi-only"
  | "dual-vi-top"
  | "dual-en-top";

const INITIAL_SUBTITLES: Subtitle[] = [
  { id: "s1", startTime: 1.2, endTime: 4.5, text: "Welcome to the future of subtitle generation.", selected: false },
  { id: "s2", startTime: 5.0, endTime: 9.2, text: "Our AI-powered tool transcribes your audio with 98.5% accuracy.", selected: false },
  { id: "s3", startTime: 9.8, endTime: 13.1, text: "Optimized for a stable English subtitle workflow.", selected: false },
  { id: "s4", startTime: 13.7, endTime: 17.4, text: "Edit, style, and export your subtitles in just a few clicks.", selected: false },
  { id: "s5", startTime: 18.0, endTime: 22.0, text: "Download as SRT, VTT, or burn subtitles directly into your video.", selected: false },
  { id: "s6", startTime: 22.5, endTime: 26.8, text: "Join thousands of creators who trust SubAI every day.", selected: false },
  { id: "s7", startTime: 27.3, endTime: 31.0, text: "Start your free trial today — no credit card required.", selected: false },
  { id: "s8", startTime: 31.5, endTime: 35.0, text: "Experience the power of AI-driven subtitle automation.", selected: false },
];

const FONTS = ["Inter", "Roboto", "Arial", "Georgia", "Courier New"];
const FONT_SIZES = ["Small", "Medium", "Large", "Extra Large"];
const EXPORT_RESOLUTIONS: ExportResolution[] = ["360p", "720p", "1080p"];
const SUBTITLE_DISPLAY_OPTIONS: Array<{ mode: SubtitleDisplayMode; label: string; description: string }> = [
  { mode: "off", label: "Off", description: "No subtitles" },
  { mode: "en-only", label: "English Only", description: "Show English subtitles" },
  { mode: "vi-only", label: "Vietnamese Only", description: "Show Vietnamese subtitles" },
  { mode: "dual-vi-top", label: "Dual (VI Top)", description: "Vietnamese on top, English on bottom" },
  { mode: "dual-en-top", label: "Dual (EN Top)", description: "English on top, Vietnamese on bottom" },
];

type StreamStatus = "idle" | "streaming" | "done" | "error";

function formatTime(secs: number): string {
  if (!Number.isFinite(secs) || secs < 0) return "00:00.00";
  const m = Math.floor(secs / 60);
  const s = Math.floor(secs % 60);
  const ms = Math.round((secs % 1) * 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

const ARTICLES = new Set(["a", "an", "the"]);
const AUXILIARIES = new Set([
  "am", "is", "are", "was", "were", "be", "been", "being",
  "do", "does", "did", "have", "has", "had",
  "will", "would", "can", "could", "should", "may", "might", "must",
]);
const PREPOSITIONS = new Set([
  "to", "in", "on", "at", "for", "from", "with", "by", "of", "about",
  "into", "over", "under", "after", "before", "between", "through", "during",
]);

function normalizeWord(word: string): string {
  return word.toLowerCase().replace(/[^a-z']/g, "");
}

function endsWithStrongPunctuation(word: string): boolean {
  return /[.!?]$/.test(word);
}

function endsWithSoftPunctuation(word: string): boolean {
  return /[,;:]$/.test(word);
}

function canBreakBetween(prevWord: string, nextWord: string): boolean {
  const prev = normalizeWord(prevWord);
  const next = normalizeWord(nextWord);

  if (!prev || !next) return true;
  if (ARTICLES.has(prev)) return false;
  if (AUXILIARIES.has(prev)) return false;
  if (PREPOSITIONS.has(prev)) return false;
  return true;
}

function getBalancedBreakIndex(words: Word[]): number {
  const MAX_LINE_CHARS = 42;
  const plain = words.map((w) => w.word);
  const total = plain.join(" ").length;

  // Một dòng ngắn (≤42) thì không cần xuống dòng.
  if (words.length <= 6 && total <= MAX_LINE_CHARS) {
    return -1;
  }

  let bestBreak = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  // Ưu tiên break giữ cả 2 dòng ≤42; trong số đó chọn điểm cân bằng nhất.
  let bestFitBreak = -1;
  let bestFitScore = Number.POSITIVE_INFINITY;

  for (let i = 1; i <= plain.length - 1; i++) {
    const left = plain.slice(0, i).join(" ");
    const right = plain.slice(i).join(" ");
    const score = Math.abs(left.length - right.length);
    const valid = canBreakBetween(plain[i - 1], plain[i]);
    if (!valid) continue;

    if (left.length <= MAX_LINE_CHARS && right.length <= MAX_LINE_CHARS) {
      if (score < bestFitScore) {
        bestFitScore = score;
        bestFitBreak = i;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      bestBreak = i;
    }
  }

  if (bestFitBreak !== -1) return bestFitBreak;
  // Không có điểm nào giữ được 2 dòng ≤42 (segment dài bất thường) → break cân bằng nhất.
  if (total <= MAX_LINE_CHARS) return -1;
  return bestBreak;
}

function buildCaptionText(words: Word[], lineBreakIndex: number, visibleCount = words.length): string {
  const visible = words.slice(0, Math.max(0, visibleCount));
  if (visible.length === 0) return "";
  if (lineBreakIndex <= 0) return visible.map((w) => w.word).join(" ");

  const line1Words = visible.slice(0, lineBreakIndex).map((w) => w.word);
  const line2Words = visible.slice(lineBreakIndex).map((w) => w.word);
  if (line2Words.length === 0) {
    return line1Words.join(" ");
  }
  return `${line1Words.join(" ")}\n${line2Words.join(" ")}`;
}

// Wrap chuỗi 1 dòng thành tối đa 2 dòng, mỗi dòng ≤ maxChars (chuẩn CPL phụ đề).
// Chọn điểm ngắt giữa từ sao cho 2 dòng cân bằng nhất.
function wrapToTwoLines(text: string, maxChars = 42): string {
  const t = text.trim();
  if (t.length <= maxChars) return t;
  const words = t.split(/\s+/);
  let best = -1;
  let bestScore = Number.POSITIVE_INFINITY;
  for (let i = 1; i < words.length; i++) {
    const left = words.slice(0, i).join(" ");
    const right = words.slice(i).join(" ");
    const score = Math.abs(left.length - right.length);
    // Ưu tiên điểm giữ cả 2 dòng ≤ maxChars; nếu không có, lấy cân bằng nhất.
    const fits = left.length <= maxChars && right.length <= maxChars;
    const penalty = fits ? 0 : 1000;
    if (penalty + score < bestScore) {
      bestScore = penalty + score;
      best = i;
    }
  }
  if (best === -1) return t;
  return `${words.slice(0, best).join(" ")}\n${words.slice(best).join(" ")}`;
}

function buildYouTubeCaptions(words: Word[]): CaptionSegment[] {
  if (words.length === 0) return [];

  const MIN_DURATION = 1.5;
  const MAX_DURATION = 4.0;
  const IDEAL_MIN_WORDS = 5;
  const IDEAL_MAX_WORDS = 15;
  const MAX_WORDS = 22;
  const PAUSE_THRESHOLD = 0.6;
  const EXTEND_SECONDS = 0.25;
  // Chuẩn phụ đề: ≤42 ký tự/dòng, tối đa 2 dòng → ≤84 ký tự/segment.
  // ≤17 ký tự/giây (CPS) để người xem kịp đọc.
  const MAX_LINE_CHARS = 42;
  const MAX_SEGMENT_CHARS = MAX_LINE_CHARS * 2;
  const MAX_CPS = 17;
  const MIN_GAP = 0.05;

  const charLen = (ws: Word[]) => ws.reduce((n, w) => n + w.word.length + 1, 0) - 1;

  const result: CaptionSegment[] = [];
  let start = 0;

  while (start < words.length) {
    let end = start;

    while (end < words.length - 1) {
      const current = words[end];
      const next = words[end + 1];
      const count = end - start + 1;
      const duration = current.end - words[start].start;
      const gap = next.start - current.end;
      // Số ký tự nếu thêm từ kế tiếp — chặn segment vượt 2 dòng.
      const charsWithNext = charLen(words.slice(start, end + 2));

      const forceBreak =
        duration >= MAX_DURATION ||
        count >= MAX_WORDS ||
        charsWithNext > MAX_SEGMENT_CHARS ||
        gap > PAUSE_THRESHOLD;

      const naturalBreak =
        endsWithStrongPunctuation(current.word) ||
        endsWithSoftPunctuation(current.word) ||
        gap > PAUSE_THRESHOLD ||
        canBreakBetween(current.word, next.word);

      const preferBreak =
        count >= IDEAL_MIN_WORDS &&
        (count >= IDEAL_MAX_WORDS || duration >= MIN_DURATION) &&
        naturalBreak;

      if (forceBreak || preferBreak) {
        break;
      }

      end += 1;
    }

    const segmentWords = words.slice(start, end + 1);
    const nextWord = words[end + 1];
    const lastWordEnd = segmentWords[segmentWords.length - 1].end;
    const segStart = segmentWords[0].start;

    // CPS guard: kéo dài duration để CPS ≤ 17 (nếu có chỗ trống trước từ kế).
    const chars = charLen(segmentWords);
    const minDurForCps = chars / MAX_CPS;
    const desiredEnd = Math.max(lastWordEnd + EXTEND_SECONDS, segStart + minDurForCps);
    const ceilEnd = nextWord ? nextWord.start - MIN_GAP : desiredEnd;
    const finalEnd = nextWord ? Math.min(desiredEnd, ceilEnd) : desiredEnd;

    result.push({
      start: segStart,
      end: Math.max(finalEnd, lastWordEnd),
      words: segmentWords,
      lineBreakIndex: getBalancedBreakIndex(segmentWords),
      text: "",
    });

    start = end + 1;
  }

  for (const cap of result) {
    cap.text = buildCaptionText(cap.words, cap.lineBreakIndex);
  }

  return result;
}

export function EditorPage() {
  const [subtitles, setSubtitles] = useState<Subtitle[]>([]);
  const [englishSubtitles, setEnglishSubtitles] = useState<Subtitle[]>([]);
  const [vietnameseSubtitles, setVietnameseSubtitles] = useState<Subtitle[]>([]);
  const [subtitleLang, setSubtitleLang] = useState<"en" | "vi">("vi");
  const [subtitleMode, setSubtitleMode] = useState<"sentence" | "progressive">("progressive");
  const [subtitleDisplayMode, setSubtitleDisplayMode] = useState<SubtitleDisplayMode>("vi-only");
  const [showSubtitleMenu, setShowSubtitleMenu] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [selectedSubId, setSelectedSubId] = useState<string | null>(null);
  const [subtitlePosition, setSubtitlePosition] = useState<"bottom" | "top">("bottom");
  const [selectedFont, setSelectedFont] = useState("Inter");
  const [selectedFontSize, setSelectedFontSize] = useState("Medium");
  const [fontColor, setFontColor] = useState("#ffffff");
  const [bgColor, setBgColor] = useState("#000000");
  const [bgOpacity, setBgOpacity] = useState(75);
  const [savedMsg, setSavedMsg] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");
  const [fontDropOpen, setFontDropOpen] = useState(false);
  const videoPlayerRef = useRef<HTMLVideoElement>(null);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoFileName, setVideoFileName] = useState("Untitled video");
  const [totalDuration, setTotalDuration] = useState(36); // fallback
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [exportingResolution, setExportingResolution] = useState<ExportResolution | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [englishWords, setEnglishWords] = useState<Word[]>([]);
  const [vietnameseWords, setVietnameseWords] = useState<Word[]>([]);
  const [inProgressWords, setInProgressWords] = useState<string[]>([]);
  const [latestRealtimeSegment, setLatestRealtimeSegment] = useState<{ en: string; vi: string } | null>(null);
  const [isRealtimeMode, setIsRealtimeMode] = useState(false);
  const [streamProgress, setStreamProgress] = useState(0);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [streamError, setStreamError] = useState<string | null>(null);
  const [undoStack, setUndoStack] = useState<Subtitle[][]>([]);
  const [redoStack, setRedoStack] = useState<Subtitle[][]>([]);
  const [noJobData, setNoJobData] = useState(false);
  const [subtitleAnchor, setSubtitleAnchor] = useState({ x: 50, y: 60 });
  const [isDraggingSubtitle, setIsDraggingSubtitle] = useState(false);
  const fakePlayheadRef = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    return () => {
      if (fakePlayheadRef.current) clearInterval(fakePlayheadRef.current);
    };
  }, []);
  const progressBarRef = useRef<HTMLDivElement>(null);
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const subtitleDragOffsetRef = useRef({ x: 0, y: 0 });
  const triedServerUrlRef = useRef(false);

  const loadVideoFromServer = useCallback((clearBlob = false) => {
    const serverFilename = sessionStorage.getItem("videoServerFilename");
    if (!serverFilename) return;
    triedServerUrlRef.current = true;
    if (clearBlob) sessionStorage.removeItem("videoPreviewUrl");
    getVideoUrl(serverFilename).then(setVideoUrl).catch(() => setVideoUrl(null));
  }, []);

  const cloneSubtitles = (items: Subtitle[]) => items.map((s) => ({ ...s }));
  const draftKey = (jobId: string, lang: "en" | "vi") => `subtitle_draft_${jobId}_${lang}`;

  const mapWordsToUiSubtitles = (words: Word[]) => {
    const subs = wordsToSubtitles(words);
    return subs.map((s, i) => ({
      id: `s${i}`,
      startTime: s.startTime,
      endTime: s.endTime,
      text: s.text,
      selected: false,
    }));
  };

  const mergeMappedWithDraft = (prev: Subtitle[], mapped: Subtitle[]) => {
    const prevById = new Map(prev.map((item) => [item.id, item]));
    return mapped.map((item) => {
      const existing = prevById.get(item.id);
      return existing ? { ...item, text: existing.text } : item;
    });
  };

  const updateCurrentLanguageSubtitles = (next: Subtitle[]) => {
    setSubtitles(next);
    if (subtitleLang === "vi") {
      setVietnameseSubtitles(next);
    } else {
      setEnglishSubtitles(next);
    }
  };

  const applySubtitleChange = (updater: (prev: Subtitle[]) => Subtitle[]) => {
    setSubtitles((prev) => {
      const next = updater(prev);
      setUndoStack((u) => [...u, cloneSubtitles(prev)].slice(-100));
      setRedoStack([]);
      if (subtitleLang === "vi") {
        setVietnameseSubtitles(next);
      } else {
        setEnglishSubtitles(next);
      }
      return next;
    });
  };

  const videoRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const modeInUrl = params.get("mode");
    const modeInSession = sessionStorage.getItem("subtitleProcessMode");
    const realtime = modeInUrl === "realtime" || modeInSession === "realtime";
    setIsRealtimeMode(realtime);
    // Realtime chỉ hỗ trợ sentence mode — progressive không ổn với streaming.
    if (realtime) setSubtitleMode("sentence");

    const blobUrl = sessionStorage.getItem("videoPreviewUrl");
    const serverFilename = sessionStorage.getItem("videoServerFilename");
    const uploadedName = sessionStorage.getItem("uploadedFileName");
    if (uploadedName) setVideoFileName(uploadedName);

    if (blobUrl) {
      setVideoUrl(blobUrl);
    } else if (serverFilename) {
      loadVideoFromServer();
    }

    // Đọc subtitle từ job thật
    const raw = sessionStorage.getItem("currentJob");
    if (!raw) {
      setNoJobData(true);
      return;
    }

    try {
      const job = JSON.parse(raw);
      if (job.job_id) setCurrentJobId(job.job_id);
      if (realtime) {
        setStreamStatus(job.status === "done" ? "done" : "streaming");
        setStreamProgress(job.progress ?? 0);
      }
      const enWords: Word[] = job.english_words ?? [];
      const viWords: Word[] = job.vietnamese_words ?? [];
      setEnglishWords(enWords);
      setVietnameseWords(viWords);

      const mappedEn = mapWordsToUiSubtitles(enWords);
      const mappedVi = mapWordsToUiSubtitles(viWords);

      const draftEnRaw = job.job_id ? sessionStorage.getItem(draftKey(job.job_id, "en")) : null;
      const draftViRaw = job.job_id ? sessionStorage.getItem(draftKey(job.job_id, "vi")) : null;
      const draftEn = draftEnRaw ? (JSON.parse(draftEnRaw) as Subtitle[]) : null;
      const draftVi = draftViRaw ? (JSON.parse(draftViRaw) as Subtitle[]) : null;

      const resolvedEn = draftEn && draftEn.length > 0 ? draftEn : mappedEn;
      const resolvedVi = draftVi && draftVi.length > 0 ? draftVi : mappedVi;

      setEnglishSubtitles(resolvedEn);
      setVietnameseSubtitles(resolvedVi);

      const initialLang: "en" | "vi" = resolvedVi.length > 0 ? "vi" : "en";
      const initialSubs = initialLang === "vi" ? resolvedVi : resolvedEn;

      if (initialSubs.length > 0) {
        setSubtitleLang(initialLang);
        setSubtitles(initialSubs);
        setSelectedSubId(initialSubs[0].id);
      }
      setUndoStack([]);
      setRedoStack([]);
    } catch (e) {
      console.error("Failed to parse job", e);
    }
  }, []);

  const streamStartedRef = useRef(false);

  useEffect(() => {
    if (!isRealtimeMode || !currentJobId) return;
    if (streamStartedRef.current) return;
    streamStartedRef.current = true;

    setStreamStatus("streaming");
    let cancelled = false;
    let es: EventSource | null = null;

    openRealtimeStream(currentJobId, {
      onEvent: (evt: RealtimeStreamEvent) => {
        if (cancelled) return;

        if (evt.type === "word_partial") {
          setInProgressWords((prev) => {
            const updated = [...prev, evt.word];
            return updated.slice(-12);
          });
          return;
        }

        if (evt.type === "snapshot") {
          setInProgressWords([]);
          setLatestRealtimeSegment(null);
          setStreamProgress(evt.progress ?? 0);
          setEnglishWords(evt.english_words ?? []);
          setVietnameseWords(evt.vietnamese_words ?? []);
          if (evt.status === "done") {
            setStreamStatus("done");
            setStreamProgress(100);
          }
          return;
        }

        if (evt.type === "segment") {
          const segWordCount = (evt.english_words ?? []).length;
          // Xóa đúng số từ của segment này, giữ lại từ mới đã arrive sau flush.
          // Tránh mất từ khi word_partial của câu tiếp theo đến trước segment event.
          setInProgressWords((prev) => prev.slice(segWordCount));
          const enText = (evt.english_words ?? []).map((w) => w.word).join(" ");
          const viText = (evt.vietnamese_words ?? []).map((w) => w.word).join(" ");
          if (enText || viText) {
            setLatestRealtimeSegment({ en: enText, vi: viText });
          }
          setStreamProgress(evt.progress ?? 0);
          setEnglishWords((prev) => [...prev, ...(evt.english_words ?? [])]);
          setVietnameseWords((prev) => [...prev, ...(evt.vietnamese_words ?? [])]);
          return;
        }

        if (evt.type === "done") {
          setStreamStatus("done");
          setStreamProgress(100);
          return;
        }

        if (evt.type === "error") {
          setStreamStatus("error");
          setStreamError(evt.message || "Realtime stream failed.");
          return;
        }

        if (evt.type === "segment_error") {
          const [start, end] = evt.time_range;
          setEnglishWords((prev) => [...prev, { word: "[...]", start, end }]);
          setVietnameseWords((prev) => [...prev, { word: "[...]", start, end }]);
          return;
        }
      },
      onError: () => {
        if (cancelled) return;
        setStreamStatus("error");
        setStreamError("Lost connection to realtime stream.");
      },
    }).then((stream) => {
      if (cancelled) {
        stream.close();
      } else {
        es = stream;
      }
    });

    return () => {
      cancelled = true;
      es?.close();
    };
  }, [isRealtimeMode, currentJobId]);

  useEffect(() => {
    if (!isRealtimeMode) return;
    setEnglishSubtitles((prev) => mergeMappedWithDraft(prev, mapWordsToUiSubtitles(englishWords)));
  }, [englishWords, isRealtimeMode]);

  useEffect(() => {
    if (!isRealtimeMode) return;
    setVietnameseSubtitles((prev) => mergeMappedWithDraft(prev, mapWordsToUiSubtitles(vietnameseWords)));
  }, [vietnameseWords, isRealtimeMode]);

  useEffect(() => {
    if (inProgressWords.length === 0) return;
    const timer = setTimeout(() => setInProgressWords([]), 3000);
    return () => clearTimeout(timer);
  }, [inProgressWords]);

  useEffect(() => {
    const preferred = subtitleLang === "vi" ? vietnameseSubtitles : englishSubtitles;
    const fallback = subtitleLang === "vi" ? englishSubtitles : vietnameseSubtitles;
    const next = preferred.length > 0 ? preferred : fallback;

    if (next.length > 0) {
      setSubtitles(next);
      if (!selectedSubId || !next.some((s) => s.id === selectedSubId)) {
        setSelectedSubId(next[0].id);
      }
    }
  }, [subtitleLang, vietnameseSubtitles, englishSubtitles, selectedSubId]);

  useEffect(() => {
    if (subtitleDisplayMode === "en-only" || subtitleDisplayMode === "dual-en-top") {
      setSubtitleLang("en");
    } else if (subtitleDisplayMode === "vi-only" || subtitleDisplayMode === "dual-vi-top") {
      setSubtitleLang("vi");
    }
    // "off" → giữ nguyên
  }, [subtitleDisplayMode]);

  useEffect(() => {
    setSubtitleAnchor((prev) => ({ ...prev, y: subtitlePosition === "bottom" ? 60 : 12 }));
  }, [subtitlePosition]);

  useEffect(() => {
    const vid = videoPlayerRef.current;
    if (!vid) return;
    vid.muted = isMuted;
    vid.volume = isMuted ? 0 : volume;
  }, [isMuted, volume]);

  const seekToTime = (nextTime: number) => {
    const clamped = Math.min(Math.max(nextTime, 0), totalDuration || 0);
    setCurrentTime(clamped);
    const vid = videoPlayerRef.current;
    if (vid && Number.isFinite(clamped)) {
      vid.currentTime = clamped;
    }
  };

  const seekFromClientX = (clientX: number) => {
    const bar = progressBarRef.current;
    if (!bar || totalDuration <= 0) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    seekToTime(pct * totalDuration);
  };

  useEffect(() => {
    if (!isScrubbing) return;

    const onMove = (e: MouseEvent) => seekFromClientX(e.clientX);
    const onUp = () => setIsScrubbing(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isScrubbing, totalDuration]);

  useEffect(() => {
    if (!isDraggingSubtitle) return;

    const onMove = (e: MouseEvent) => {
      const frame = videoFrameRef.current;
      if (!frame) return;

      const rect = frame.getBoundingClientRect();
      const x = ((e.clientX - subtitleDragOffsetRef.current.x - rect.left) / rect.width) * 100;
      const y = ((e.clientY - subtitleDragOffsetRef.current.y - rect.top) / rect.height) * 100;

      setSubtitleAnchor({
        x: Math.max(5, Math.min(95, x)),
        y: Math.max(8, Math.min(92, y)),
      });
    };

    const onUp = () => setIsDraggingSubtitle(false);

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [isDraggingSubtitle]);

  // Playhead simulation
  const handlePlayToggle = () => {
    const vid = videoPlayerRef.current;
    if (vid) {
      // Dùng video thật
      isPlaying ? vid.pause() : vid.play();
      setIsPlaying(!isPlaying);
    } else {
      if (!isPlaying) {
        let t = currentTime;
        if (fakePlayheadRef.current) clearInterval(fakePlayheadRef.current);
        fakePlayheadRef.current = setInterval(() => {
          t += 0.1;
          if (t >= totalDuration) {
            clearInterval(fakePlayheadRef.current!);
            fakePlayheadRef.current = null;
            setIsPlaying(false);
            setCurrentTime(0);
          } else {
            setCurrentTime(t);
          }
        }, 100);
      }
    }
  };

  const handleExportVideo = async (resolution: ExportResolution) => {
    if (isRealtimeMode && streamStatus !== "done") {
      setExportError("Realtime is still processing. Please wait until completion.");
      return;
    }
    if (!currentJobId) {
      setExportError("Cannot export: missing job id.");
      return;
    }

    setExportError(null);
    setShowExportMenu(false);
    setExportingResolution(resolution);
    try {
      const started = await exportVideoApi(currentJobId, resolution, subtitleLang);
      const data = await pollExportUntilDone(started.export_id);
      if (!data.download_url || !data.filename) throw new Error("Export completed but download URL is missing");
      const a = document.createElement("a");
      a.href = data.download_url;
      a.download = data.filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Export failed";
      setExportError(message);
    } finally {
      setExportingResolution(null);
    }
  };

  const currentSubtitle = subtitles.find(
    (s) => currentTime >= s.startTime && currentTime <= s.endTime
  );

  const activeWords = subtitleLang === "vi" ? vietnameseWords : englishWords;
  const fallbackWords = subtitleLang === "vi" ? englishWords : vietnameseWords;
  const displayWords = activeWords.length > 0 ? activeWords : fallbackWords;
  const youtubeCaptions = useMemo(() => buildYouTubeCaptions(displayWords), [displayWords]);
  const activeYoutubeCaption = useMemo(
    () => youtubeCaptions.find((c) => currentTime >= c.start && currentTime <= c.end),
    [youtubeCaptions, currentTime],
  );
  const progressiveText = useMemo(() => {
    // Prefer edited subtitle content so overlay reflects user edits immediately.
    if (currentSubtitle?.text) {
      const words = currentSubtitle.text.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) return "";

      const duration = Math.max(0.2, currentSubtitle.endTime - currentSubtitle.startTime);
      const ratio = Math.min(1, Math.max(0, (currentTime - currentSubtitle.startTime) / duration));
      const visibleCount = Math.min(words.length, Math.max(1, Math.ceil(ratio * words.length)));
      return words.slice(0, visibleCount).join(" ");
    }

    // Fallback for cases where no editable subtitle block matches current time.
    if (!activeYoutubeCaption) return "";
    const visibleCount = activeYoutubeCaption.words.filter((w) => w.start <= currentTime).length;
    return activeYoutubeCaption.words.slice(0, visibleCount).map((w) => w.word).join(" ");
  }, [currentSubtitle, currentTime, activeYoutubeCaption]);

  const currentSubtitleEn = useMemo(
    () => englishSubtitles.find((s) => currentTime >= s.startTime && currentTime <= s.endTime),
    [englishSubtitles, currentTime],
  );
  const currentSubtitleVi = useMemo(
    () => vietnameseSubtitles.find((s) => currentTime >= s.startTime && currentTime <= s.endTime),
    [vietnameseSubtitles, currentTime],
  );

  const buildProgressiveFromSubtitle = (sub?: Subtitle) => {
    if (!sub?.text) return "";
    const words = sub.text.trim().split(/\s+/).filter(Boolean);
    if (words.length === 0) return "";
    const duration = Math.max(0.2, sub.endTime - sub.startTime);
    const ratio = Math.min(1, Math.max(0, (currentTime - sub.startTime) / duration));
    const visibleCount = Math.min(words.length, Math.max(1, Math.ceil(ratio * words.length)));
    return words.slice(0, visibleCount).join(" ");
  };

  const textEn = subtitleMode === "progressive"
    ? buildProgressiveFromSubtitle(currentSubtitleEn)
    : (currentSubtitleEn?.text ?? "");
  const textVi = subtitleMode === "progressive"
    ? buildProgressiveFromSubtitle(currentSubtitleVi)
    : (currentSubtitleVi?.text ?? "");

  const isDualMode = subtitleDisplayMode === "dual-vi-top" || subtitleDisplayMode === "dual-en-top";

  // Bypass time-based lookup CHỈ KHI đang streaming active VÀ playhead ở mép live.
  // Mép live = currentTime nằm sau từ cuối cùng đã nhận (chưa có sub time-based cho
  // vị trí đó). Khi user tua/scrub về quá khứ, currentTime < mép live → dùng
  // time-based lookup để subtitle khớp đúng vị trí video.
  const lastStreamedEnd = useMemo(() => {
    const w = activeWords[activeWords.length - 1] ?? fallbackWords[fallbackWords.length - 1];
    return w?.end ?? 0;
  }, [activeWords, fallbackWords]);
  const atLiveEdge = currentTime >= lastStreamedEnd - 1.0;
  const isLiveStreaming =
    isRealtimeMode && streamStatus === "streaming" && isPlaying && !isScrubbing && atLiveEdge;
  const textEnLive = isLiveStreaming
    ? (inProgressWords.length > 0
        ? inProgressWords.join(" ")
        : (latestRealtimeSegment?.en ?? ""))  // gap-fill giữa segment và word_partial tiếp theo
    : textEn;
  const textViLive = isLiveStreaming
    ? (latestRealtimeSegment?.vi ?? "")
    : textVi;

  // Dual mode: EN partial words về trước, VI dịch chỉ có sau khi segment chốt
  // (và ngược lại ngay sau flush). Để cả hai dòng không bị nhấp nháy/biến mất,
  // fallback mỗi bên về segment hoàn tất gần nhất khi live partial của bên đó rỗng.
  const textEnDual = isLiveStreaming
    ? (textEnLive || latestRealtimeSegment?.en || textEn)
    : textEn;
  const textViDual = isLiveStreaming
    ? (textViLive || latestRealtimeSegment?.vi || textVi)
    : textVi;

  const subtitleLines = useMemo(() => {
    // Wrap mỗi dòng overlay thành tối đa 2 dòng ≤42 ký tự (CPL chuẩn).
    const en = textEnLive ? wrapToTwoLines(textEnLive) : "";
    const vi = textViLive ? wrapToTwoLines(textViLive) : "";
    // Dual mode dùng text fallback để cả hai ngôn ngữ luôn hiển thị song song.
    const enDual = textEnDual ? wrapToTwoLines(textEnDual) : "";
    const viDual = textViDual ? wrapToTwoLines(textViDual) : "";
    switch (subtitleDisplayMode) {
      case "off":
        return [] as string[];
      case "en-only":
        return en ? [en] : [];
      case "vi-only":
        return vi ? [vi] : [];
      case "dual-vi-top":
        return [viDual, enDual].filter(Boolean);
      case "dual-en-top":
        return [enDual, viDual].filter(Boolean);
      default:
        return [] as string[];
    }
  }, [subtitleDisplayMode, textEnLive, textViLive, textEnDual, textViDual]);

  const filteredSubtitles = useMemo(
    () => subtitles.filter((s) => s.text.toLowerCase().includes(searchTerm.toLowerCase())),
    [subtitles, searchTerm],
  );

  const updateSubtitleText = (id: string, text: string) => {
    applySubtitleChange((prev) => prev.map((s) => (s.id === id ? { ...s, text } : s)));
  };

  const deleteSubtitle = (id: string) => {
    applySubtitleChange((prev) => prev.filter((s) => s.id !== id));
    if (selectedSubId === id) setSelectedSubId(null);
  };

  const addSubtitle = () => {
    const lastEnd = subtitles[subtitles.length - 1]?.endTime ?? 0;
    const newSub: Subtitle = {
      id: `s${Date.now()}`,
      startTime: lastEnd + 0.5,
      endTime: lastEnd + 4,
      text: "New subtitle text here...",
      selected: false,
    };
    applySubtitleChange((prev) => [...prev, newSub]);
    setSelectedSubId(newSub.id);
  };

  const handleSave = () => {
    if (currentJobId) {
      sessionStorage.setItem(draftKey(currentJobId, subtitleLang), JSON.stringify(subtitles));
    }
    setSavedMsg(true);
    setTimeout(() => setSavedMsg(false), 2000);
  };

  const handleUndo = () => {
    if (undoStack.length === 0) return;
    const previous = undoStack[undoStack.length - 1];
    setUndoStack((u) => u.slice(0, -1));
    setRedoStack((r) => [...r, cloneSubtitles(subtitles)].slice(-100));
    updateCurrentLanguageSubtitles(cloneSubtitles(previous));
    if (selectedSubId && !previous.some((s) => s.id === selectedSubId)) {
      setSelectedSubId(previous[0]?.id ?? null);
    }
  };

  const handleRedo = () => {
    if (redoStack.length === 0) return;
    const next = redoStack[redoStack.length - 1];
    setRedoStack((r) => r.slice(0, -1));
    setUndoStack((u) => [...u, cloneSubtitles(subtitles)].slice(-100));
    updateCurrentLanguageSubtitles(cloneSubtitles(next));
    if (selectedSubId && !next.some((s) => s.id === selectedSubId)) {
      setSelectedSubId(next[0]?.id ?? null);
    }
  };

  const handleDownloadSRT = () => {
    const content = subtitles
      .map((s, i) => {
        const start = formatTime(s.startTime).replace(".", ",");
        const end = formatTime(s.endTime).replace(".", ",");
        return `${i + 1}\n00:${start} --> 00:${end}\n${s.text}\n`;
      })
      .join("\n");
    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "subtitles.srt";
    a.click();
  };

  const safeDuration = totalDuration > 0 ? totalDuration : 1;
  const timelineProgress = (currentTime / safeDuration) * 100;
  const canExport = !isRealtimeMode || streamStatus === "done";

  if (noJobData) return <Navigate to="/upload" replace />;

  return (
    <div className="h-screen bg-gray-950 text-white flex flex-col overflow-hidden">
      {/* Top Bar */}
      <div className="border-b border-gray-800 bg-gray-900 px-4 py-2.5 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="text-sm text-gray-400 truncate max-w-48">
            {videoFileName}
          </div>
          <span className="text-xs bg-green-900 text-green-400 px-2 py-0.5 rounded-full border border-green-800">
            Subtitles Ready
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Realtime chỉ dùng sentence mode → ẩn toggle; normal cho chọn cả hai. */}
          {!isRealtimeMode && (
            <div className="flex items-center gap-1 p-1 rounded-lg bg-gray-800 border border-gray-700">
              <button
                onClick={() => setSubtitleMode("sentence")}
                className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                  subtitleMode === "sentence" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Sentence
              </button>
              <button
                onClick={() => setSubtitleMode("progressive")}
                className={`px-2.5 py-1 text-xs rounded-md transition-all ${
                  subtitleMode === "progressive" ? "bg-indigo-600 text-white" : "text-gray-400 hover:text-white"
                }`}
              >
                Progressive
              </button>
            </div>
          )}

          <button
            onClick={handleUndo}
            disabled={undoStack.length === 0}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Undo"
          >
            <Undo className="w-4 h-4" />
          </button>
          <button
            onClick={handleRedo}
            disabled={redoStack.length === 0}
            className="p-2 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            title="Redo"
          >
            <Redo className="w-4 h-4" />
          </button>
          <div className="w-px h-5 bg-gray-700 mx-1" />

          <button
            onClick={handleSave}
            className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white px-3 py-1.5 rounded-lg hover:bg-gray-800 transition-all"
          >
            <AnimatePresence mode="wait">
              {savedMsg ? (
                <motion.span
                  key="saved"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-1.5 text-green-400"
                >
                  <Check className="w-4 h-4" /> Saved
                </motion.span>
              ) : (
                <motion.span key="save" className="flex items-center gap-1.5" initial={{ opacity: 1 }} exit={{ opacity: 0 }}>
                  <Save className="w-4 h-4" /> Save
                </motion.span>
              )}
            </AnimatePresence>
          </button>

          <div className="w-px h-5 bg-gray-700 mx-1" />

          {/* Download Menu */}
          <button
            onClick={handleDownloadSRT}
            className="flex items-center gap-1.5 text-sm bg-violet-600 hover:bg-violet-500 text-white px-3 py-1.5 rounded-lg transition-all"
          >
            <FileText className="w-4 h-4" />
            Download SRT
          </button>
          <div className="relative">
            <button
              onClick={() => setShowExportMenu((prev) => !prev)}
              className="flex items-center gap-1.5 text-sm bg-indigo-600 hover:bg-indigo-500 text-white px-3 py-1.5 rounded-lg transition-all disabled:opacity-60"
              disabled={!!exportingResolution || !canExport}
            >
              <Video className="w-4 h-4" />
              {exportingResolution
                ? `Exporting ${exportingResolution}...`
                : !canExport
                ? "Waiting Realtime..."
                : "Export Video"}
              <ChevronDown className="w-3.5 h-3.5" />
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-1 w-40 rounded-xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden z-30">
                {EXPORT_RESOLUTIONS.map((res) => (
                  <button
                    key={res}
                    onClick={() => handleExportVideo(res)}
                    className="w-full text-left px-3 py-2 text-xs text-gray-200 hover:bg-gray-800 transition-colors"
                  >
                    {res}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
      {exportError && (
        <div className="px-4 py-2 text-xs text-red-300 bg-red-950/40 border-b border-red-900">
          {exportError}
        </div>
      )}

      {/* Realtime stream status bar */}
      {isRealtimeMode && streamStatus === "streaming" && (
        <div className="px-4 py-2 bg-indigo-950/60 border-b border-indigo-800 flex items-center gap-3">
          <motion.div
            animate={{ rotate: 360 }}
            transition={{ repeat: Infinity, duration: 1.2, ease: "linear" }}
            className="w-3 h-3 border-2 border-indigo-400 border-t-transparent rounded-full flex-shrink-0"
          />
          <div className="flex-1 h-1.5 bg-indigo-900 rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-indigo-400 rounded-full"
              animate={{ width: `${streamProgress}%` }}
              transition={{ ease: "easeOut" }}
            />
          </div>
          <span className="text-xs text-indigo-300 whitespace-nowrap tabular-nums">
            Realtime đang xử lý… {streamProgress}%
          </span>
        </div>
      )}
      {isRealtimeMode && streamStatus === "error" && (
        <div className="px-4 py-2 text-xs text-red-300 bg-red-950/40 border-b border-red-900 flex items-center gap-2">
          <span className="font-semibold">Lỗi Realtime:</span>
          <span>{streamError}</span>
        </div>
      )}

      {/* Main Layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Video + Timeline */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Video Player */}
          <div className="flex-1 min-h-0 bg-gray-950 flex items-center justify-center p-4">
            <div ref={videoRef} className="relative w-full h-full max-w-4xl flex items-center justify-center">
              <div
                ref={videoFrameRef}
                className="relative w-full aspect-video rounded-xl overflow-hidden shadow-2xl shadow-black/50 bg-black"
              >
                {videoUrl ? (
                  <video
                    ref={videoPlayerRef}
                    src={videoUrl}
                    className="w-full h-full object-contain"
                    onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => setTotalDuration(e.currentTarget.duration)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                    onEnded={() => setIsPlaying(false)}
                    onError={() => {
                      if (!triedServerUrlRef.current) {
                        loadVideoFromServer(true);
                      } else {
                        setVideoUrl(null);
                        sessionStorage.removeItem("videoPreviewUrl");
                      }
                    }}
                  />
                ) : (
                  <div className="w-full h-full bg-gray-900 flex items-center justify-center text-gray-500 text-sm">
                    Đang tải video…
                  </div>
                )}

                {/* Subtitle Overlay */}
                {subtitleLines.length > 0 && (
                  <motion.div
                    initial={{ opacity: 0, y: subtitlePosition === "bottom" ? 8 : -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.18, ease: "easeOut" }}
                    onMouseDown={(e) => {
                      const frame = videoFrameRef.current;
                      if (!frame) return;
                      const rect = frame.getBoundingClientRect();
                      const anchorX = rect.left + (subtitleAnchor.x / 100) * rect.width;
                      const anchorY = rect.top + (subtitleAnchor.y / 100) * rect.height;
                      subtitleDragOffsetRef.current = {
                        x: e.clientX - anchorX,
                        y: e.clientY - anchorY,
                      };
                      setIsDraggingSubtitle(true);
                    }}
                    className="absolute px-4 max-w-[90%] cursor-move"
                    style={{
                      left: `${subtitleAnchor.x}%`,
                      top: `${subtitleAnchor.y}%`,
                      transform: "translate(-50%, -50%)",
                    }}
                  >
                    <div className="flex flex-col gap-2 items-start">
                      {subtitleLines.map((line, idx) => (
                        <span
                          key={`subtitle-line-${idx}`}
                          className="inline-block px-4 py-2 rounded-lg backdrop-blur-sm text-left"
                          style={{
                            color: fontColor,
                            backgroundColor: `${bgColor}${Math.round(bgOpacity * 2.55).toString(16).padStart(2, "0")}`,
                            fontFamily: selectedFont,
                            fontSize: selectedFontSize === "Small" ? "14px" : selectedFontSize === "Medium" ? "18px" : selectedFontSize === "Large" ? "22px" : "26px",
                            whiteSpace: "pre-line",
                          }}
                        >
                          {line}
                        </span>
                      ))}
                    </div>
                  </motion.div>
                )}

                {/* Play overlay */}
                {!isPlaying && (
                  <div className="absolute inset-0 flex items-center justify-center">
                    <button
                      onClick={handlePlayToggle}
                      className="w-16 h-16 rounded-full bg-black/50 hover:bg-black/70 backdrop-blur-sm flex items-center justify-center transition-all border border-white/20 hover:scale-105"
                    >
                      <Play className="w-7 h-7 text-white ml-1" />
                    </button>
                  </div>
                )}

                {/* Fullscreen button */}
                <button
                  onClick={() => videoPlayerRef.current?.requestFullscreen()}
                  className="absolute top-3 right-3 p-1.5 rounded-lg bg-black/40 hover:bg-black/60 text-white transition-all z-10"
                >
                  <Maximize2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>

          {/* Video Controls */}
          <div className="bg-gray-900 border-t border-gray-800 px-4 py-3">
            <div className="flex items-center gap-3 mb-3">
              <button
                onClick={() => seekToTime(Math.max(0, currentTime - 5))}
                className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={handlePlayToggle}
                className="w-8 h-8 rounded-lg bg-violet-600 hover:bg-violet-500 flex items-center justify-center transition-colors"
              >
                {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
              </button>
              <button
                onClick={() => seekToTime(Math.min(totalDuration, currentTime + 5))}
                className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              {/* Volume: slider render dạng absolute popover để KHÔNG đẩy các nút
                  bên cạnh khi hover. Hover-zone chỉ bao quanh nút âm lượng. */}
              <div
                className="relative flex items-center"
                onMouseEnter={() => setShowVolumeSlider(true)}
                onMouseLeave={() => setShowVolumeSlider(false)}
              >
                <button
                  onClick={() => setIsMuted((prev) => !prev)}
                  className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                  title="Volume"
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4" />
                  ) : volume < 0.5 ? (
                    <Volume1 className="w-4 h-4" />
                  ) : (
                    <Volume2 className="w-4 h-4" />
                  )}
                </button>

                <AnimatePresence>
                  {showVolumeSlider && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700 bg-gray-900 shadow-xl z-30"
                    >
                      <input
                        type="range"
                        min={0}
                        max={1}
                        step={0.05}
                        value={isMuted ? 0 : volume}
                        onChange={(e) => {
                          const next = Number(e.target.value);
                          setVolume(next);
                          setIsMuted(next === 0);
                        }}
                        className="w-20 h-1.5 accent-violet-500"
                      />
                      <span className="text-[10px] text-gray-400 tabular-nums w-8">
                        {Math.round((isMuted ? 0 : volume) * 100)}%
                      </span>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Subtitle options: tách hẳn khỏi hover-zone của volume. */}
              <div className="relative">
                <button
                  onClick={() => setShowSubtitleMenu((prev) => !prev)}
                  className="p-1.5 rounded-lg hover:bg-gray-800 text-gray-400 hover:text-white transition-colors"
                  title="Subtitle options"
                >
                  <FileText className="w-4 h-4" />
                </button>

                <AnimatePresence>
                  {showSubtitleMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 8 }}
                      className="absolute bottom-full mb-2 left-0 min-w-[220px] rounded-xl border border-gray-700 bg-gray-900 shadow-xl overflow-hidden z-30"
                    >
                      <div className="px-3 py-2 text-[11px] text-gray-400 border-b border-gray-700">
                        SUBTITLE OPTIONS
                      </div>
                      {SUBTITLE_DISPLAY_OPTIONS.map((option) => (
                        <button
                          key={option.mode}
                          onClick={() => {
                            setSubtitleDisplayMode(option.mode);
                            setShowSubtitleMenu(false);
                          }}
                          className={`w-full text-left px-3 py-2.5 hover:bg-gray-800 transition-colors ${
                            subtitleDisplayMode === option.mode ? "bg-gray-800/70" : ""
                          }`}
                        >
                          <div className="text-xs text-white">{option.label}</div>
                          <div className="text-[11px] text-gray-400">{option.description}</div>
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div
                ref={progressBarRef}
                className="flex-1 h-2 bg-gray-800 rounded-full relative cursor-pointer overflow-visible"
                onMouseDown={(e) => {
                  setIsScrubbing(true);
                  seekFromClientX(e.clientX);
                }}
              >
                <div
                  className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full transition-all"
                  style={{ width: `${timelineProgress}%` }}
                />
                <div
                  className="absolute top-1/2 w-3 h-3 rounded-full bg-white shadow-md cursor-grab active:cursor-grabbing"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setIsScrubbing(true);
                    seekFromClientX(e.clientX);
                  }}
                  style={{ left: `${timelineProgress}%`, transform: "translate(-50%, -50%)" }}
                />
              </div>

              <span className="text-xs text-gray-500 whitespace-nowrap tabular-nums">
                {formatTime(currentTime)} / {formatTime(totalDuration)}
              </span>
            </div>

            {/* Timeline Subtitle Track */}
            <div className="relative h-10 bg-gray-800 rounded-lg overflow-hidden">
              {subtitles.map((sub) => {
                const left = (sub.startTime / totalDuration) * 100;
                const width = ((sub.endTime - sub.startTime) / totalDuration) * 100;
                return (
                  <button
                    key={sub.id}
                    onClick={() => { setSelectedSubId(sub.id); seekToTime(sub.startTime); }}
                    className={`absolute top-1 bottom-1 rounded-md px-1.5 text-xs truncate transition-all ${
                      selectedSubId === sub.id
                        ? "bg-violet-600 text-white"
                        : "bg-violet-900/60 text-violet-300 hover:bg-violet-800/60"
                    }`}
                    style={{ left: `${left}%`, width: `${width}%`, minWidth: "20px" }}
                    title={sub.text}
                  >
                    {sub.text}
                  </button>
                );
              })}
              {/* Playhead */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-10 pointer-events-none"
                style={{ left: `${timelineProgress}%` }}
              />
            </div>
          </div>
        </div>

        {/* Center: Subtitle Editor */}
        <div className="w-72 xl:w-80 bg-gray-900 border-x border-gray-800 flex flex-col">
          <div className="p-3 border-b border-gray-800">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm text-white flex items-center gap-2">
                <Edit3 className="w-4 h-4 text-violet-400" />
                Subtitles
                <span className="text-xs text-gray-500 bg-gray-800 px-1.5 py-0.5 rounded-md">
                  {subtitles.length}
                </span>
              </h2>
              <button
                onClick={addSubtitle}
                className="flex items-center gap-1 text-xs text-violet-400 hover:text-violet-300 px-2 py-1 rounded-lg hover:bg-gray-800 transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
            </div>
            {/* Search */}
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500" />
              <input
                type="text"
                placeholder="Search subtitles..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg pl-8 pr-3 py-2 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-violet-500"
              />
            </div>
          </div>

          {/* Subtitle List */}
          <div className="subtitle-scrollbar flex-1 min-h-0 overflow-y-auto p-2 pr-1 space-y-1.5">
            {filteredSubtitles.map((sub) => (
              <motion.div
                key={sub.id}
                layout
                onClick={() => { setSelectedSubId(sub.id); seekToTime(sub.startTime); }}
                className={`rounded-xl border p-3 cursor-pointer transition-all ${
                  selectedSubId === sub.id
                    ? "border-violet-500 bg-violet-950/50"
                    : "border-gray-800 bg-gray-800/40 hover:border-gray-700"
                }`}
              >
                <div className="flex items-start justify-between gap-2 mb-1.5">
                  <div className="flex items-center gap-1.5 text-xs text-gray-500">
                    <Clock className="w-3 h-3" />
                    <span className="tabular-nums">{formatTime(sub.startTime)}</span>
                    <span>→</span>
                    <span className="tabular-nums">{formatTime(sub.endTime)}</span>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteSubtitle(sub.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-gray-700 text-gray-600 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
                {selectedSubId === sub.id ? (
                  <textarea
                    value={sub.text}
                    onChange={(e) => updateSubtitleText(sub.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    className="w-full bg-transparent text-xs text-gray-200 resize-none focus:outline-none leading-relaxed"
                    rows={2}
                    autoFocus
                  />
                ) : (
                  <p className="text-xs text-gray-300 leading-relaxed line-clamp-2">{sub.text}</p>
                )}
              </motion.div>
            ))}
          </div>
        </div>

        {/* Right: Tools Panel */}
        <div className="w-64 xl:w-72 bg-gray-900 border-l border-gray-800 flex flex-col">
          {/* Header */}
          <div className="flex items-center gap-1.5 border-b border-gray-800 py-3 px-4 text-xs text-violet-400">
            <Palette className="w-3.5 h-3.5" />
            Style
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            <div className="space-y-4">
                  {/* Position */}
                  <div>
                    <label className="text-xs text-gray-400 mb-2 flex items-center gap-1.5">
                      <AlignCenter className="w-3.5 h-3.5" /> Position
                    </label>
                    <div className="flex gap-2">
                      {(["top", "bottom"] as const).map((pos) => (
                        <button
                          key={pos}
                          onClick={() => setSubtitlePosition(pos)}
                          className={`flex-1 py-2 rounded-lg text-xs capitalize transition-all ${
                            subtitlePosition === pos
                              ? "bg-violet-600 text-white"
                              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                          }`}
                        >
                          {pos === "top" ? (
                            <AlignStartVertical className="w-3.5 h-3.5 mx-auto mb-0.5" />
                          ) : (
                            <AlignCenter className="w-3.5 h-3.5 mx-auto mb-0.5" />
                          )}
                          {pos}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Font */}
                  <div>
                    <label className="text-xs text-gray-400 mb-2 flex items-center gap-1.5">
                      <Type className="w-3.5 h-3.5" /> Font Family
                    </label>
                    <div className="relative">
                      <button
                        onClick={() => setFontDropOpen(!fontDropOpen)}
                        className="w-full flex items-center justify-between bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-300 hover:border-gray-600 transition-colors"
                      >
                        <span style={{ fontFamily: selectedFont }}>{selectedFont}</span>
                        <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transition-transform ${fontDropOpen ? "rotate-180" : ""}`} />
                      </button>
                      <AnimatePresence>
                        {fontDropOpen && (
                          <motion.div
                            initial={{ opacity: 0, y: -4 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -4 }}
                            className="absolute top-full mt-1 left-0 right-0 bg-gray-800 border border-gray-700 rounded-xl shadow-xl z-20 overflow-hidden"
                          >
                            {FONTS.map((font) => (
                              <button
                                key={font}
                                onClick={() => { setSelectedFont(font); setFontDropOpen(false); }}
                                className={`w-full text-left px-3 py-2 text-xs transition-colors ${
                                  selectedFont === font ? "text-violet-400 bg-violet-950/50" : "text-gray-300 hover:bg-gray-700"
                                }`}
                                style={{ fontFamily: font }}
                              >
                                {font}
                              </button>
                            ))}
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </div>
                  </div>

                  {/* Font Size */}
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">Font Size</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      {FONT_SIZES.map((size) => (
                        <button
                          key={size}
                          onClick={() => setSelectedFontSize(size)}
                          className={`py-1.5 rounded-lg text-xs transition-all ${
                            selectedFontSize === size
                              ? "bg-violet-600 text-white"
                              : "bg-gray-800 text-gray-400 hover:bg-gray-700"
                          }`}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Colors */}
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">Text Color</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={fontColor}
                        onChange={(e) => setFontColor(e.target.value)}
                        className="w-10 h-10 rounded-lg border-0 bg-transparent cursor-pointer"
                      />
                      <span className="text-xs text-gray-400 font-mono">{fontColor.toUpperCase()}</span>
                    </div>
                  </div>

                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">Background Color</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="color"
                        value={bgColor}
                        onChange={(e) => setBgColor(e.target.value)}
                        className="w-10 h-10 rounded-lg border-0 bg-transparent cursor-pointer"
                      />
                      <span className="text-xs text-gray-400 font-mono">{bgColor.toUpperCase()}</span>
                    </div>
                    <div className="mt-2">
                      <div className="flex items-center justify-between mb-1">
                        <label className="text-xs text-gray-400">Opacity</label>
                        <span className="text-xs text-gray-500">{bgOpacity}%</span>
                      </div>
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={bgOpacity}
                        onChange={(e) => setBgOpacity(Number(e.target.value))}
                        className="w-full accent-violet-500"
                      />
                    </div>
                  </div>

                  {/* Preview */}
                  <div>
                    <label className="text-xs text-gray-400 mb-2 block">Preview</label>
                    <div className="bg-gray-800 rounded-xl h-16 flex items-center justify-center">
                      <span
                        className="px-3 py-1.5 rounded-lg text-sm"
                        style={{
                          color: fontColor,
                          backgroundColor: `${bgColor}${Math.round(bgOpacity * 2.55).toString(16).padStart(2, "0")}`,
                          fontFamily: selectedFont,
                          fontSize: selectedFontSize === "Small" ? "12px" : selectedFontSize === "Medium" ? "14px" : selectedFontSize === "Large" ? "16px" : "18px",
                        }}
                      >
                        Sample subtitle text
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
  );
}
