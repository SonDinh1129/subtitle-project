/**
 * api.ts — Frontend Service Layer (View ↔ Controller)
 * ──────────────────────────────────────────────────────
 * Toàn bộ giao tiếp với Flask backend đi qua đây.
 * URL gốc lấy từ biến môi trường VITE_API_URL.
 *
 * Dev  : VITE_API_URL=http://localhost:5000/api  (Flask)
 * Prod : VITE_API_URL=/api                       (Flask serve React)
 */

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:5000/api").replace(/\/$/, "");

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

export type RealtimeStreamEvent =
  | StreamSegmentEvent
  | StreamSnapshotEvent
  | StreamDoneEvent
  | StreamErrorEvent;

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
export function uploadVideo(
  file: File,
  processMode: ProcessMode = "normal",
  translationMode: "segment" | "sentence" = "segment",
  onProgress?: (pct: number) => void,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.append("file", file);
    form.append("process_mode", processMode);
    form.append("translation_mode", translationMode);

    const xhr = new XMLHttpRequest();
    xhr.upload.addEventListener("progress", (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    });
    xhr.addEventListener("load", () => {
      if (xhr.status === 200) {
        resolve((JSON.parse(xhr.responseText) as { job_id: string }).job_id);
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
      }
    });
    xhr.addEventListener("error", () => reject(new Error("Network error during upload")));
    xhr.open("POST", `${BASE}/upload`);
    xhr.send(form);
  });
}

export function openRealtimeStream(
  jobId: string,
  handlers: {
    onEvent: (evt: RealtimeStreamEvent) => void;
    onError?: (err: Event) => void;
  },
): EventSource {
  const stream = new EventSource(`${BASE}/jobs/${jobId}/stream`);

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
  const res = await fetch(`${BASE}/jobs/${jobId}`);
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
  const res = await fetch(`${BASE}/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
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
