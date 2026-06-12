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
  | "transcribing"
  | "translating"
  | "aligning"
  | "generating_srt"
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

export interface WordPartialEvent {
  type: "word_partial";
  word: string;
  frame_ts: number;
}

export type RealtimeStreamEvent =
  | StreamSegmentEvent
  | StreamSnapshotEvent
  | StreamDoneEvent
  | StreamErrorEvent
  | StreamSegmentErrorEvent
  | WordPartialEvent;

export type ExportResolution = "360p" | "720p" | "1080p";
export type SubtitleLang = "en" | "vi";
export type ExportLang = "en" | "vi" | "dual";

export interface SrtBlock {
  start: number;
  end: number;
  text: string;
}

export interface ExportSubtitlesPayload {
  en?: SrtBlock[];
  vi?: SrtBlock[];
  order?: "vi-en" | "en-vi"; // only used when lang === "dual"
}

export interface ExportResponse {
  export_id: string;
  status: "pending" | "done" | "error";
  filename?: string;
  download_url?: string;
  error?: string;
}

// ─── Status messages (hiển thị trên UI) ─────────────────────────────────────

export const STATUS_MESSAGES: Record<JobStatus, string> = {
  queued:         "Đang xếp hàng...",
  extracting:     "Trích xuất âm thanh...",
  transcribing:   "AI đang nhận dạng & dịch thuật...",
  translating:    "Đang dịch...",
  aligning:       "Đang căn chỉnh...",
  generating_srt: "Tạo file phụ đề...",
  done:           "Hoàn tất!",
  error:          "Đã xảy ra lỗi",
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

/** POST /api/auth/sse-token — returns a 60s JWT for EventSource ?token= param. */
async function getSseToken(): Promise<string> {
  const res = await authFetch('/auth/sse-token', { method: 'POST' })
  if (!res.ok) throw new Error(`SSE token fetch failed (${res.status})`)
  const data = await res.json() as { token: string }
  return data.token
}

export async function openRealtimeStream(
  jobId: string,
  handlers: {
    onEvent: (evt: RealtimeStreamEvent) => void;
    onError?: (err: Event) => void;
  },
): Promise<EventSource> {
  let token = ''
  try {
    token = await getSseToken()
  } catch {
    // Fall back to session token if SSE token endpoint unavailable
    const { data: { session } } = await supabase.auth.getSession()
    token = session?.access_token ?? ''
  }
  const url = token
    ? `${BASE}/jobs/${jobId}/stream?token=${encodeURIComponent(token)}`
    : `${BASE}/jobs/${jobId}/stream`
  const stream = new EventSource(url)

  stream.onmessage = (event) => {
    try {
      const payload = JSON.parse(event.data) as RealtimeStreamEvent
      handlers.onEvent(payload)
      if (payload.type === 'done' || payload.type === 'error') {
        stream.close()
      }
    } catch {
      handlers.onEvent({
        type: 'error',
        message: 'Invalid stream payload from server.',
      })
      stream.close()
    }
  }

  stream.onerror = (err) => {
    handlers.onError?.(err)
  }

  return stream
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
 * GET /api/jobs/:jobId/srt-url?lang=en|vi
 * Fetch a short-lived signed URL for the SRT file in Supabase Storage.
 */
export async function getSrtUrl(jobId: string, lang: "en" | "vi"): Promise<string> {
  const res = await authFetch(`/jobs/${jobId}/srt-url?lang=${lang}`);
  if (!res.ok) throw new Error(`SRT URL fetch failed (${res.status})`);
  const data = await res.json() as { url: string; expires_in: number };
  return data.url;
}

/**
 * POST /api/export
 * Starts async export. Returns 202 with export_id immediately.
 * Poll getExportStatus until status === "done".
 */
export async function exportVideo(
  jobId: string,
  resolution: ExportResolution,
  lang: ExportLang,
  subtitles?: ExportSubtitlesPayload,
): Promise<ExportResponse> {
  const res = await authFetch(`/export`, {
    method: "POST",
    body: JSON.stringify({ job_id: jobId, resolution, lang, subtitles }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Export failed (${res.status}): ${text}`);
  }
  return res.json();
}

/** GET /api/export-status/:exportId — returns current export status. */
export async function getExportStatus(exportId: string): Promise<ExportResponse> {
  const res = await authFetch(`/export-status/${exportId}`);
  if (!res.ok) throw new Error(`Export status check failed (${res.status})`);
  return res.json();
}

/** Poll export status until done or error. Returns the final ExportResponse. */
export function pollExportUntilDone(
  exportId: string,
  onUpdate?: (r: ExportResponse) => void,
  intervalMs = 2000,
): Promise<ExportResponse> {
  return new Promise((resolve, reject) => {
    const tick = async () => {
      try {
        const r = await getExportStatus(exportId)
        onUpdate?.(r)
        if (r.status === "done") return resolve(r)
        if (r.status === "error") return reject(new Error(r.error ?? "Export failed"))
        setTimeout(tick, intervalMs)
      } catch (err) {
        reject(err)
      }
    }
    tick()
  })
}

/** Trigger browser download of the SRT from Supabase Storage signed URL. */
export async function downloadSrt(jobId: string, lang: "en" | "vi"): Promise<void> {
  const url = await getSrtUrl(jobId, lang);
  const a = document.createElement("a");
  a.href = url;
  a.download = `subtitles_${lang}.srt`;
  document.body.appendChild(a);
  a.click();
  a.remove();
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
  const MAX_CPS = 17;
  const MIN_GAP = 0.05;

  // Bước 1: gom từ thành block theo giới hạn ký tự.
  type Block = { startTime: number; endTime: number; text: string };
  const blocks: Block[] = [];
  let buf: string[] = [], chars = 0, t0: number | null = null;

  for (const wd of words) {
    if (t0 === null) t0 = wd.start;
    const wlen = wd.word.length + 1;
    if (chars + wlen > maxChars && buf.length) {
      blocks.push({ startTime: t0!, endTime: wd.start, text: buf.join(" ") });
      buf = [wd.word]; chars = wd.word.length; t0 = wd.start;
    } else {
      buf.push(wd.word); chars += wlen;
    }
  }
  if (buf.length) {
    blocks.push({ startTime: t0!, endTime: words.at(-1)!.end, text: buf.join(" ") });
  }

  // Bước 2: CPS guard — kéo dài duration block quá ngắn để CPS ≤ 17,
  // nhưng không lấn sang block kế tiếp. Sửa lỗi CPS=1000+ do timestamp sát nhau.
  return blocks.map((b, i) => {
    const minDur = b.text.length / MAX_CPS;
    const next = blocks[i + 1];
    const ceil = next ? next.startTime - MIN_GAP : Infinity;
    const endTime = Math.min(Math.max(b.endTime, b.startTime + minDur), ceil);
    return {
      id: `sub_${i}`,
      startTime: b.startTime,
      endTime: Math.max(endTime, b.endTime),
      text: b.text,
      selected: false,
    };
  });
}

// ─── Profile API ─────────────────────────────────────────────────────────────

export async function updateProfile(fullName: string): Promise<Response> {
  return authFetch('/auth/profile', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full_name: fullName }),
  })
}

export async function changePassword(newPassword: string): Promise<Response> {
  return authFetch('/auth/change-password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ new_password: newPassword }),
  })
}

export async function deleteAccount(): Promise<Response> {
  return authFetch('/auth/account', {
    method: 'DELETE',
  })
}

/**
 * GET /api/auth/confirmation-status?email=...
 * Public — lets the post-signup "check your email" screen detect when the user
 * confirmed via the magic link, even if the link was opened in another browser.
 * Returns false on any error so the caller simply keeps polling.
 */
export async function getConfirmationStatus(email: string): Promise<boolean> {
  try {
    const res = await fetch(`${BASE}/auth/confirmation-status?email=${encodeURIComponent(email)}`)
    if (!res.ok) return false
    const data = await res.json() as { confirmed?: boolean }
    return data.confirmed === true
  } catch {
    return false
  }
}
