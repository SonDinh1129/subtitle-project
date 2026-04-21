/**
 * api.ts — Frontend Service Layer (View ↔ Controller)
 * ──────────────────────────────────────────────────────
 * Toàn bộ giao tiếp với Flask backend đi qua đây.
 * URL gốc lấy từ biến môi trường VITE_API_URL.
 *
 * Dev  : VITE_API_URL=http://localhost:5000/api  (Flask)
 * Prod : VITE_API_URL=/api                       (Flask serve React)
 */

import { supabase } from "./supabase";

function _isLoopbackHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

function _resolveBaseUrl(): string {
  const viteEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const raw = (viteEnv?.VITE_API_URL ?? "/api").replace(/\/$/, "");

  if (typeof window === "undefined") return raw;

  try {
    const parsed = new URL(raw, window.location.origin);
    const samePort = parsed.port === window.location.port;
    const localAliasMismatch =
      samePort &&
      _isLoopbackHost(parsed.hostname) &&
      _isLoopbackHost(window.location.hostname) &&
      parsed.hostname !== window.location.hostname;

    // Avoid CORS when only localhost/127.0.0.1 alias differs on the same local port.
    if (localAliasMismatch && parsed.pathname.startsWith("/api")) {
      return "/api";
    }

    return raw;
  } catch {
    return raw;
  }
}

const BASE = _resolveBaseUrl();

/** Returns "Bearer <token>" or null if no active session. */
export async function getAuthHeader(): Promise<string | null> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;
  return `Bearer ${session.access_token}`;
}

/**
 * Authenticated fetch using a pre-resolved token.
 * Use this when you already have the access_token (e.g. during auth state changes).
 */
export async function authFetchWithToken(path: string, token: string): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
  });
}

/** Authenticated fetch for JSON endpoints. Throws if not authenticated. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = await getAuthHeader();
  if (!token) throw new Error("Not authenticated");
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
      Authorization: token,
    },
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type JobStatus =
  | "queued"
  | "extracting"
  | "vad"
  | "transcribing"
  | "generating"
  | "done"
  | "error";

export interface Word {
  word:  string;
  start: number;
  end:   number;
}

export interface JobResponse {
  job_id:            string;
  filename?:         string;
  status:            JobStatus;
  progress:          number;
  error?:            string;
  english_words?:    Word[];
  vietnamese_words?: Word[];
  english_text?:     string;
  vietnamese_text?:  string;
}

export type ProcessMode = "normal" | "realtime";

export interface UploadResponse {
  jobId: string;
  videoFilename: string;
}

export interface StreamSegmentEvent {
  type: "segment";
  index: number;
  total: number;
  progress: number;
  english_words: Word[];
  vietnamese_words: Word[];
}

export interface StreamSnapshotEvent {
  type: "snapshot";
  status: JobStatus;
  progress: number;
  english_words: Word[];
  vietnamese_words: Word[];
}

export interface StreamDoneEvent {
  type: "done";
  progress: 100;
}

export interface StreamErrorEvent {
  type: "error";
  message: string;
}

export interface StreamSegmentErrorEvent {
  type: "segment_error";
  time_range: [number, number];  // [start_seconds, end_seconds]
  message: string;
}

export type RealtimeStreamEvent =
  | StreamSegmentEvent
  | StreamSnapshotEvent
  | StreamDoneEvent
  | StreamErrorEvent
  | StreamSegmentErrorEvent;

export type ExportResolution = "360p" | "720p" | "1080p";
export type SubtitleLang = "en" | "vi";

export interface ExportResponse {
  job_id: string;
  resolution: ExportResolution;
  lang: SubtitleLang;
  filename: string;
  download_url: string;
}

// ─── Status messages (hiển thị trên UI) ─────────────────────────────────────

export const STATUS_MESSAGES: Record<JobStatus, string> = {
  queued:       "Đang xếp hàng...",
  extracting:   "Trích xuất âm thanh...",
  vad:          "Phát hiện giọng nói (VAD)...",
  transcribing: "AI đang nhận dạng & dịch thuật...",
  generating:   "Tạo file phụ đề...",
  done:         "Hoàn tất!",
  error:        "Đã xảy ra lỗi",
};

// ─── API calls ────────────────────────────────────────────────────────────────

/**
 * POST /api/upload
 * Upload video file, nhận job_id để poll.
 * onProgress: 0–100 (XHR upload progress)
 */
export async function uploadVideo(
  file: File,
  processMode: ProcessMode = "normal",
  translationMode: "segment" | "sentence" = "segment",
  onProgress?: (pct: number) => void,
  sourceLang: "en" | "vi" = "en",
): Promise<UploadResponse> {
  const authToken = await getAuthHeader();

  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("process_mode", processMode);
    form.append("translation_mode", translationMode);
    form.append("source_lang", sourceLang);

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        const parsed = JSON.parse(xhr.responseText) as { job_id: string; video_filename?: string };
        resolve({
          jobId: parsed.job_id,
          videoFilename: parsed.video_filename ?? parsed.job_id,
        });
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.open("POST", `${BASE}/upload`);
    if (authToken) xhr.setRequestHeader("Authorization", authToken);
    xhr.send(form);
  });
}

export async function getVideoUrl(videoFilename: string): Promise<string> {
  const authHeader = await getAuthHeader();
  const path = `/video/${encodeURIComponent(videoFilename)}`;
  if (!authHeader) return `${BASE}${path}`;
  const token = authHeader.slice(7); // strip "Bearer "
  return `${BASE}${path}?token=${encodeURIComponent(token)}`;
}

export async function openRealtimeStream(
  jobId: string,
  handlers: {
    onEvent: (evt: RealtimeStreamEvent) => void;
    onError?: (err: Event) => void;
  },
): Promise<EventSource> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token ?? "";
  const url = token
    ? `${BASE}/jobs/${jobId}/stream?token=${encodeURIComponent(token)}`
    : `${BASE}/jobs/${jobId}/stream`;
  const stream = new EventSource(url);

  stream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as RealtimeStreamEvent;
      handlers.onEvent(payload);
      if (payload.type === "done" || payload.type === "error") {
        stream.close();
      }
    } catch {
      handlers.onEvent({
        type: "error",
        message: "Invalid stream payload from server.",
      });
      stream.close();
    }
  };

  stream.onerror = (err) => {
    handlers.onError?.(err);
  };

  return stream;
}

/**
 * GET /api/jobs/:jobId
 * Lấy trạng thái + kết quả của job.
 */
export async function getJobStatus(jobId: string): Promise<JobResponse> {
  const res = await authFetch(`/jobs/${jobId}`);
  if (!res.ok) throw new Error(`Status check failed (${res.status})`);
  return res.json();
}

/**
 * Poll backend cho đến khi job done hoặc error.
 * Gọi onUpdate mỗi lần có thay đổi.
 */
export function pollUntilDone(
  jobId: string,
  onUpdate: (job: JobResponse) => void,
  intervalMs = 1500,
): Promise<JobResponse> {
  return new Promise((resolve, reject) => {
    const id = setInterval(async () => {
      try {
        const job = await getJobStatus(jobId);
        onUpdate(job);
        if (job.status === "done")  { clearInterval(id); resolve(job); }
        if (job.status === "error") { clearInterval(id); reject(new Error(job.error ?? "Pipeline error")); }
      } catch (err) {
        clearInterval(id);
        reject(err);
      }
    }, intervalMs);
  });
}

/**
 * GET /api/jobs/:jobId/download/:lang
 * Trả về URL để tải SRT.
 */
export function getSrtUrl(jobId: string, lang: "en" | "vi"): string {
  return `${BASE}/jobs/${jobId}/download/${lang}`;
}

/**
 * POST /api/export
 * Tạo video đã burn subtitle theo độ phân giải chọn.
 */
export async function exportVideo(
  jobId: string,
  resolution: ExportResolution,
  lang: SubtitleLang,
): Promise<ExportResponse> {
  const res = await authFetch(`/export`, {
    method: "POST",
    body: JSON.stringify({ job_id: jobId, resolution, lang }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Export failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** Trigger browser download của SRT. */
export function downloadSrt(jobId: string, lang: "en" | "vi") {
  Object.assign(document.createElement("a"), {
    href: getSrtUrl(jobId, lang),
    download: `subtitles_${lang}.srt`,
  }).click();
}

// ─── Helper: Word[] → Subtitle[] (dùng trong EditorPage) ────────────────────

export interface SubtitleItem {
  id:        string;
  startTime: number;
  endTime:   number;
  text:      string;
  selected:  boolean;
}

export function wordsToSubtitles(words: Word[], maxChars = 42): SubtitleItem[] {
  const out: SubtitleItem[] = [];
  let buf: string[] = [], chars = 0, t0: number | null = null;

  for (const wd of words) {
    if (t0 === null) t0 = wd.start;
    const wlen = wd.word.length + 1;
    if (chars + wlen > maxChars && buf.length) {
      out.push({ id: `sub_${out.length}`, startTime: t0!, endTime: wd.start, text: buf.join(" "), selected: false });
      buf = [wd.word]; chars = wd.word.length; t0 = wd.start;
    } else {
      buf.push(wd.word); chars += wlen;
    }
  }
  if (buf.length) {
    out.push({ id: `sub_${out.length}`, startTime: t0!, endTime: words.at(-1)!.end, text: buf.join(" "), selected: false });
  }
  return out;
}
