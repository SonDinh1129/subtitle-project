import { useState, useRef, useCallback } from "react";
import { useNavigate, Link } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { uploadVideo, pollUntilDone, STATUS_MESSAGES, type ProcessMode } from "../../lib/api";
import { supabase } from "../../lib/supabase";
import { useUiPreferences } from "../context/UiPreferencesContext";
import { useAuth } from "../context/AuthContext";
import {
  Upload,
  FileVideo,
  X,
  CheckCircle2,
  Sparkles,
  Languages,
  Clock,
  ChevronDown,
  AlertCircle,
  Play,
  Zap,
  Lock,
  Crown,
  LogIn,
} from "lucide-react";

const SUPPORTED_FORMATS = ["MP4", "MOV", "MKV", "AVI", "WEBM"];
const SUPPORTED_EXTENSIONS = ["mp4", "mov", "mkv", "avi", "webm"];
const LANGUAGES = [
  { id: "en", en: "English → Vietnamese", vi: "Tiếng Anh → Tiếng Việt" },
  { id: "vi", en: "Vietnamese → English", vi: "Tiếng Việt → Tiếng Anh" },
];

type UploadState = "idle" | "dragover" | "uploading" | "processing" | "realtime_warming" | "done" | "error";

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

function isLikelyVideoFile(file: File): boolean {
  if (file.type.startsWith("video/")) return true;
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return SUPPORTED_EXTENSIONS.includes(ext);
}

export function UploadPage() {
  const { language: appLanguage } = useUiPreferences();
  const { isPremium, profile, user, isLoading: authLoading, refreshProfile } = useAuth();
  const isVi = appLanguage === "vi";
  const wasGuestRef = useRef(false);
  const isDemo = !authLoading && (!user || user.is_anonymous === true);
  const [demoDone, setDemoDone] = useState(() => localStorage.getItem("demo_done") === "1");
  const [state, setState] = useState<UploadState>("idle");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [processingProgress, setProcessingProgress] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [language, setLanguage] = useState("en");
  const [langOpen, setLangOpen] = useState(false);
  const [processingMsg, setProcessingMsg] = useState(isVi ? "Đang phân tích âm thanh..." : "Analyzing audio...");
  const [processMode, setProcessMode] = useState<ProcessMode>("normal");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const processingMessages = [
    isVi ? "Đang phân tích âm thanh..." : "Analyzing audio...",
    isVi ? "Đang nhận dạng tiếng Anh..." : "Transcribing to English...",
    isVi ? "Đang căn chỉnh mốc thời gian..." : "Aligning timestamps...",
    isVi ? "Đang hoàn tất phụ đề..." : "Finalizing subtitles...",
  ];

  const handleRealUpload = useCallback(async (file: File) => {
    if (!isLikelyVideoFile(file)) {
      setUploadError(isVi ? "Định dạng tệp không được hỗ trợ. Hãy dùng MP4, MOV, MKV, AVI hoặc WEBM." : "Unsupported file format. Please use MP4, MOV, MKV, AVI, or WEBM.");
      setState("error");
      return;
    }

    // Auto sign in anonymously for guest/demo users
    if (!user) {
      const { error: anonError } = await supabase.auth.signInAnonymously();
      if (anonError) {
        setUploadError(isVi ? "Không thể khởi tạo phiên demo. Vui lòng thử lại." : "Could not start demo session. Please try again.");
        setState("error");
        return;
      }
      wasGuestRef.current = true;
    }

    setSelectedFile(file);
    if (isLikelyVideoFile(file)) {
      const url = URL.createObjectURL(file);
      setPreviewUrl(url);
      sessionStorage.setItem("videoPreviewUrl", url);
    }
    setState("uploading");
    setUploadProgress(0);

    try {
      setUploadError(null);
      const { jobId, videoFilename } = await uploadVideo(file, processMode, "segment", (pct) => {
        setUploadProgress(pct);
      }, language as "en" | "vi");

      sessionStorage.setItem("uploadedFileName", file.name);
      sessionStorage.setItem("subtitleProcessMode", processMode);
      sessionStorage.setItem("videoServerFilename", videoFilename);

      if (processMode === "realtime") {
        sessionStorage.setItem(
          "currentJob",
          JSON.stringify({
            job_id: jobId,
            status: "queued",
            progress: 0,
            english_words: [],
            vietnamese_words: [],
          }),
        );
        // Giữ màn hình warmup ~2.5s để model khởi động trước khi chuyển sang Editor.
        // Khi user đến Editor, words đầu tiên đã có sẵn trong queue → sub hiện ngay.
        setState("realtime_warming");
        await new Promise<void>((resolve) => setTimeout(resolve, 2500));
        if (wasGuestRef.current) {
          localStorage.setItem("demo_done", "1");
          setDemoDone(true);
        }
        refreshProfile();
        navigate(`/editor?mode=realtime&job_id=${encodeURIComponent(jobId)}`);
        return;
      }

      setState("processing");

      const finalJob = await pollUntilDone(
        jobId,
        (job) => {
          setProcessingProgress(job.progress ?? 0);
          setProcessingMsg(STATUS_MESSAGES[job.status] ?? "Processing...");
        }
      );

      // Lưu job kết quả vào sessionStorage
      sessionStorage.setItem("currentJob", JSON.stringify(finalJob));

      setProcessingProgress(100);
      setProcessingMsg(isVi ? "Đã tạo phụ đề!" : "Subtitles generated!");
      if (wasGuestRef.current) {
        localStorage.setItem("demo_done", "1");
        setDemoDone(true);
      }
      refreshProfile();
      setState("done");

    } catch (err: unknown) {
      console.error(err);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("LIMIT_REACHED")) {
        setUploadError(isVi ? "Đã đạt giới hạn 5 video/tháng. Nâng cấp Premium để tiếp tục." : "Monthly limit of 5 videos reached. Upgrade to Premium to continue.");
      } else if (msg.includes("PREMIUM_REQUIRED")) {
        setUploadError(isVi ? "Chế độ Realtime yêu cầu tài khoản Premium." : "Realtime mode requires a Premium account.");
      } else if (msg.includes("Unsupported format") || msg.includes("File content does not match")) {
        setUploadError(isVi ? "Tệp video không hợp lệ hoặc codec không được hỗ trợ. Hãy thử xuất lại dưới định dạng MP4 (H.264 + AAC)." : "Invalid video content or unsupported codec. Try re-exporting as MP4 (H.264 + AAC).");
        setState("error");
      } else {
        setUploadError(isVi ? "Không thể tải video lên. Vui lòng thử lại hoặc kiểm tra kết nối." : "Could not upload the video. Please try again or check your connection.");
        setState("error");
      }
    }
  }, [isVi, navigate, processMode, user]);

  const startProcessing = () => {
    setState("processing");
    setProcessingProgress(0);
    let msgIdx = 0;
    let progress = 0;

    const msgInterval = setInterval(() => {
      msgIdx = (msgIdx + 1) % processingMessages.length;
      setProcessingMsg(processingMessages[msgIdx]);
    }, 1500);

    const interval = setInterval(() => {
      progress += Math.random() * 8 + 2;
      if (progress >= 100) {
        progress = 100;
        clearInterval(interval);
        clearInterval(msgInterval);
        setProcessingProgress(100);
        setProcessingMsg(isVi ? "Đã tạo phụ đề!" : "Subtitles generated!");
        setState("done");
      } else {
        setProcessingProgress(Math.min(progress, 98));
      }
    }, 150);
  };

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setState("idle");
      setUploadError(null);
      const file = e.dataTransfer.files[0];
      if (file && isLikelyVideoFile(file)) {
        handleRealUpload(file);
      } else {
        setUploadError(isVi ? "Định dạng tệp không được hỗ trợ. Hãy dùng MP4, MOV, MKV, AVI hoặc WEBM." : "Unsupported file format. Please use MP4, MOV, MKV, AVI, or WEBM.");
        setState("error");
        setTimeout(() => setState("idle"), 3000);
      }
    },
    [handleRealUpload, isVi]
  );

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!isLikelyVideoFile(file)) {
      setUploadError(isVi ? "Định dạng tệp không được hỗ trợ. Hãy dùng MP4, MOV, MKV, AVI hoặc WEBM." : "Unsupported file format. Please use MP4, MOV, MKV, AVI, or WEBM.");
      setState("error");
      setTimeout(() => setState("idle"), 3000);
      return;
    }
    setUploadError(null);
    handleRealUpload(file);
  };

  const handleReset = () => {
    setState("idle");
    setSelectedFile(null);
    setPreviewUrl(null);
    setUploadProgress(0);
    setProcessingProgress(0);
    setUploadError(null);
    sessionStorage.removeItem("subtitleProcessMode");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900 py-12 px-4 sm:px-6 lg:px-8">
      <div className="max-w-5xl mx-auto">
        {/* Page Header */}
        <div className="text-center mb-10">
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-4xl text-gray-900 dark:text-gray-100 tracking-tight mb-3"
          >
            {isVi ? "Tải video của bạn" : "Upload Your Video"}
          </motion.h1>
          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.1 }}
            className="text-gray-500 dark:text-gray-300"
          >
            {isVi
              ? "Tải video lên và mô hình tiếng Anh sẽ tạo phụ đề chính xác tự động."
              : "Upload a video file and our English model will generate accurate subtitles automatically."}
          </motion.p>
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Main Upload Area */}
          <div className="lg:col-span-2 space-y-6">
            {/* Demo banner */}
            {isDemo && !demoDone && (state === "idle" || state === "dragover") && (
              <div className="flex items-center gap-3 px-4 py-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-700 text-sm mb-2">
                <Zap className="w-4 h-4 shrink-0 text-amber-500" />
                <span className="flex-1">
                  {isVi
                    ? "Đang dùng thử demo · Chỉ Normal mode · 1 video miễn phí"
                    : "Demo mode · Normal mode only · 1 free video"}
                </span>
                <Link to="/signin" className="shrink-0 font-semibold underline underline-offset-2">
                  {isVi ? "Đăng nhập" : "Sign in"}
                </Link>
              </div>
            )}

            {/* Drop Zone */}
            <AnimatePresence mode="wait">
              {isDemo && demoDone && (
                <motion.div
                  key="demo_limit"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-10 shadow-sm flex flex-col items-center text-center gap-5"
                >
                  <div className="w-16 h-16 rounded-2xl bg-violet-50 dark:bg-violet-900/30 border border-violet-100 dark:border-violet-700/40 flex items-center justify-center">
                    <LogIn className="w-7 h-7 text-violet-500" />
                  </div>
                  <div>
                    <p className="text-gray-900 dark:text-gray-100 mb-1.5">
                      {isVi ? "Bạn đã dùng hết lượt demo" : "Demo limit reached"}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-gray-400 max-w-xs">
                      {isVi
                        ? "Đăng nhập để upload thêm video. Tài khoản miễn phí được 5 video mỗi tháng."
                        : "Sign in to upload more videos. Free accounts get 5 videos per month."}
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <Link
                      to="/signin"
                      className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white px-5 py-2.5 rounded-xl shadow-sm transition-all text-sm"
                    >
                      <LogIn className="w-4 h-4" />
                      {isVi ? "Đăng nhập" : "Sign In"}
                    </Link>
                    <Link
                      to="/signup"
                      className="flex items-center gap-2 border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 px-5 py-2.5 rounded-xl transition-all text-sm"
                    >
                      {isVi ? "Đăng ký miễn phí" : "Sign Up Free"}
                    </Link>
                  </div>
                </motion.div>
              )}

              {!demoDone && (state === "idle" || state === "dragover" || state === "error") && (
                <motion.div
                  key="dropzone"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.98 }}
                  onDragOver={(e) => { e.preventDefault(); setState("dragover"); }}
                  onDragLeave={() => setState("idle")}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`relative border-2 border-dashed rounded-2xl cursor-pointer transition-all overflow-hidden ${
                    state === "dragover"
                      ? "border-violet-500 bg-violet-50 dark:bg-violet-950/40"
                      : state === "error"
                      ? "border-red-400 bg-red-50 dark:bg-red-950/30"
                      : "border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-900 hover:border-violet-400 hover:bg-violet-50/30 dark:hover:bg-violet-950/20"
                  }`}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    className="hidden"
                    onChange={handleFileSelect}
                  />
                  <div className="py-16 px-8 flex flex-col items-center text-center">
                    <motion.div
                      animate={{ y: state === "dragover" ? -8 : 0 }}
                      transition={{ type: "spring", stiffness: 300 }}
                      className={`w-20 h-20 rounded-2xl flex items-center justify-center mb-5 ${
                        state === "error"
                          ? "bg-red-100 dark:bg-red-900/40"
                          : state === "dragover"
                          ? "bg-violet-100 dark:bg-violet-900/40"
                          : "bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-900/30 dark:to-indigo-900/30 border border-violet-100 dark:border-violet-700/40"
                      }`}
                    >
                      {state === "error" ? (
                        <AlertCircle className="w-9 h-9 text-red-500" />
                      ) : (
                        <Upload
                          className={`w-9 h-9 ${
                            state === "dragover" ? "text-violet-600" : "text-violet-400"
                          }`}
                        />
                      )}
                    </motion.div>

                    {state === "error" ? (
                      <>
                        <p className="text-red-600 dark:text-red-300 mb-1">
                          {isVi ? "Loại tệp không hợp lệ" : "Invalid file type"}
                        </p>
                        <p className="text-sm text-red-400 dark:text-red-200/80">
                          {isVi ? "Vui lòng tải lên tệp video hợp lệ" : "Please upload a valid video file"}
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-gray-700 dark:text-gray-100 mb-1">
                          {state === "dragover"
                            ? isVi
                              ? "Thả tệp vào đây!"
                              : "Drop it here!"
                            : isVi
                            ? "Kéo thả video của bạn vào đây"
                            : "Drag & drop your video here"}
                        </p>
                        <p className="text-sm text-gray-400 dark:text-gray-300 mb-4">
                          {isVi ? "hoặc" : "or"}{" "}
                          <span className="text-violet-600 dark:text-violet-300 underline underline-offset-2">
                            {isVi ? "chọn tệp để tải lên" : "browse to upload"}
                          </span>
                        </p>
                        <div className="flex flex-wrap gap-2 justify-center">
                          {SUPPORTED_FORMATS.map((fmt) => (
                            <span
                              key={fmt}
                              className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-300 px-2.5 py-1 rounded-md"
                            >
                              {fmt}
                            </span>
                          ))}
                        </div>
                        <p className="text-xs text-gray-400 dark:text-gray-300 mt-3">
                          {isVi ? "Dung lượng tối đa: 2 GB" : "Max file size: 2 GB"}
                        </p>
                      </>
                    )}
                  </div>
                </motion.div>
              )}

              {state === "uploading" && (
                <motion.div
                  key="uploading"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-6 shadow-sm"
                >
                  <div className="flex items-start gap-4">
                    {/* Video Thumbnail */}
                    <div className="w-24 h-16 rounded-xl overflow-hidden bg-gray-100 dark:bg-gray-800 flex-shrink-0 flex items-center justify-center">
                      {previewUrl ? (
                        <video src={previewUrl} className="w-full h-full object-cover" />
                      ) : (
                        <FileVideo className="w-6 h-6 text-gray-400" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <p className="text-sm text-gray-900 dark:text-gray-100 truncate">
                          {selectedFile?.name}
                        </p>
                        <button
                          onClick={handleReset}
                          className="p-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800 flex-shrink-0"
                        >
                          <X className="w-4 h-4 text-gray-400" />
                        </button>
                      </div>
                      <p className="text-xs text-gray-400 dark:text-gray-300 mb-3">
                        {selectedFile ? formatBytes(selectedFile.size) : ""}
                      </p>
                      {/* Progress bar */}
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-300">
                          <span>{isVi ? "Đang tải lên…" : "Uploading…"}</span>
                          <span>{Math.round(uploadProgress)}%</span>
                        </div>
                        <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
                          <motion.div
                            className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
                            initial={{ width: "0%" }}
                            animate={{ width: `${uploadProgress}%` }}
                            transition={{ ease: "easeOut" }}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}

              {state === "realtime_warming" && (
                <motion.div
                  key="realtime_warming"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white dark:bg-gray-900 border border-violet-200 dark:border-violet-700 rounded-2xl p-8 shadow-sm"
                >
                  <div className="text-center">
                    {/* Pulsing rings + icon */}
                    <div className="relative w-24 h-24 mx-auto mb-6">
                      <motion.div
                        className="absolute inset-0 rounded-full border-2 border-violet-300 dark:border-violet-600 opacity-60"
                        animate={{ scale: [1, 1.35, 1], opacity: [0.6, 0, 0.6] }}
                        transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut" }}
                      />
                      <motion.div
                        className="absolute inset-2 rounded-full border-2 border-violet-400 dark:border-violet-500 opacity-40"
                        animate={{ scale: [1, 1.25, 1], opacity: [0.4, 0, 0.4] }}
                        transition={{ repeat: Infinity, duration: 1.6, ease: "easeInOut", delay: 0.4 }}
                      />
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-violet-100 to-indigo-100 dark:from-violet-900/40 dark:to-indigo-900/40 border border-violet-200 dark:border-violet-700 flex items-center justify-center">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ repeat: Infinity, duration: 2.4, ease: "linear" }}
                          >
                            <Zap className="w-7 h-7 text-violet-500" />
                          </motion.div>
                        </div>
                      </div>
                    </div>

                    <h3 className="text-gray-900 dark:text-gray-100 mb-1">
                      {isVi ? "Đang khởi động Realtime" : "Starting Realtime Mode"}
                    </h3>
                    <p className="text-sm text-gray-500 dark:text-gray-300 mb-5">
                      {isVi
                        ? "Mô hình AI đang khởi động để sẵn sàng xử lý ngay khi bạn vào Editor…"
                        : "AI model is warming up so subtitles appear instantly when you enter the Editor…"}
                    </p>

                    {/* Animated step indicators */}
                    <div className="flex items-center justify-center gap-6">
                      {([
                        { label: isVi ? "Kết nối" : "Connect", delay: 0 },
                        { label: isVi ? "Khởi động" : "Warm up", delay: 0.8 },
                        { label: isVi ? "Sẵn sàng" : "Ready", delay: 1.8 },
                      ] as const).map((step) => (
                        <motion.div
                          key={step.label}
                          className="flex items-center gap-1.5"
                          initial={{ opacity: 0.3 }}
                          animate={{ opacity: 1 }}
                          transition={{ delay: step.delay, duration: 0.4 }}
                        >
                          <motion.div
                            className="w-4 h-4 rounded-full bg-violet-600 flex items-center justify-center"
                            initial={{ scale: 0 }}
                            animate={{ scale: 1 }}
                            transition={{ delay: step.delay, type: "spring", stiffness: 300 }}
                          >
                            <CheckCircle2 className="w-3 h-3 text-white" />
                          </motion.div>
                          <span className="text-xs text-gray-500 dark:text-gray-300">{step.label}</span>
                        </motion.div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {state === "processing" && (
                <motion.div
                  key="processing"
                  initial={{ opacity: 0, scale: 0.98 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-8 shadow-sm"
                >
                  <div className="text-center">
                    {/* Animated AI ring */}
                    <div className="relative w-24 h-24 mx-auto mb-6">
                      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 96 96">
                        <circle
                          cx="48" cy="48" r="44"
                          fill="none" stroke="#f3f4f6" strokeWidth="8"
                        />
                        <motion.circle
                          cx="48" cy="48" r="44"
                          fill="none"
                          stroke="url(#grad)"
                          strokeWidth="8"
                          strokeLinecap="round"
                          strokeDasharray={276.46}
                          strokeDashoffset={276.46 * (1 - processingProgress / 100)}
                          transition={{ ease: "easeOut" }}
                        />
                        <defs>
                          <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="0%">
                            <stop offset="0%" stopColor="#7c3aed" />
                            <stop offset="100%" stopColor="#4f46e5" />
                          </linearGradient>
                        </defs>
                      </svg>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <motion.div
                          animate={{ rotate: 360 }}
                          transition={{ repeat: Infinity, duration: 2, ease: "linear" }}
                        >
                          <Sparkles className="w-7 h-7 text-violet-600" />
                        </motion.div>
                      </div>
                    </div>

                    <AnimatePresence mode="wait">
                      <motion.p
                        key={processingMsg}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        className="text-gray-700 dark:text-gray-100 mb-1"
                      >
                        {processingMsg}
                      </motion.p>
                    </AnimatePresence>
                    <p className="text-sm text-gray-400 dark:text-gray-300 mb-4">
                      {isVi
                        ? `${Math.round(processingProgress)}% hoàn tất · Dự kiến 1-2 phút`
                        : `${Math.round(processingProgress)}% complete · Estimated 1-2 minutes`}
                    </p>

                    <div className="h-2 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden max-w-xs mx-auto">
                      <motion.div
                        className="h-full bg-gradient-to-r from-violet-500 to-indigo-500 rounded-full"
                        initial={{ width: "0%" }}
                        animate={{ width: `${processingProgress}%` }}
                      />
                    </div>

                    {/* Steps */}
                    <div className="flex items-center justify-center gap-6 mt-6">
                      {[
                        isVi ? "Nhận dạng" : "Transcription",
                        isVi ? "Căn chỉnh" : "Alignment",
                        isVi ? "Định dạng" : "Formatting",
                      ].map((step, i) => (
                        <div key={step} className="flex items-center gap-1.5">
                          <div
                            className={`w-4 h-4 rounded-full flex items-center justify-center ${
                              processingProgress > i * 33
                                ? "bg-violet-600"
                                : "bg-gray-200 dark:bg-gray-700"
                            }`}
                          >
                            {processingProgress > i * 33 && (
                              <CheckCircle2 className="w-3 h-3 text-white" />
                            )}
                          </div>
                          <span className="text-xs text-gray-500 dark:text-gray-300">{step}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              )}

              {state === "done" && (
                <motion.div
                  key="done"
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  className="bg-white dark:bg-gray-900 border border-green-200 dark:border-green-700 rounded-2xl p-8 shadow-sm text-center"
                >
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 300, delay: 0.1 }}
                    className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto mb-4"
                  >
                    <CheckCircle2 className="w-8 h-8 text-green-600" />
                  </motion.div>
                  <h3 className="text-gray-900 dark:text-gray-100 mb-1">{isVi ? "Đã tạo phụ đề!" : "Subtitles Generated!"}</h3>
                  <p className="text-sm text-gray-500 dark:text-gray-300 mb-6">
                    {isVi
                      ? "Phụ đề đã sẵn sàng. Xem trước và chỉnh sửa trong Editor."
                      : "Your subtitles are ready. Preview and edit them in the editor."}
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3 justify-center">
                    <button
                      onClick={() => {
                        if (selectedFile) {
                          // Lưu tên file để EditorPage gọi API lấy về
                          sessionStorage.setItem("uploadedFileName", selectedFile.name);
                        }
                        if (previewUrl) sessionStorage.setItem("videoPreviewUrl", previewUrl);
                        navigate("/editor");
                      }}
                      className="flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 text-white px-6 py-2.5 rounded-xl hover:from-violet-700 hover:to-indigo-700 transition-all shadow-sm"
                    >
                      <Play className="w-4 h-4" />
                      {isVi ? "Mở trong Editor" : "Open in Editor"}
                    </button>
                    {isDemo && demoDone ? (
                      <Link
                        to="/signup"
                        className="flex items-center justify-center gap-2 border border-violet-300 text-violet-700 dark:text-violet-200 dark:border-violet-700 px-6 py-2.5 rounded-xl hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-all text-sm"
                      >
                        {isVi ? "Đăng ký để upload thêm" : "Sign Up to Upload More"}
                      </Link>
                    ) : (
                      <button
                        onClick={handleReset}
                        className="flex items-center justify-center gap-2 text-gray-600 dark:text-gray-200 border border-gray-200 dark:border-gray-700 px-6 py-2.5 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-all"
                      >
                        <Upload className="w-4 h-4" />
                        {isVi ? "Tải video khác" : "Upload Another"}
                      </button>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Generate Button */}
            {state === "idle" && !(isDemo && demoDone) && (
              <button
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white py-3.5 rounded-xl shadow-md shadow-violet-200 hover:shadow-lg transition-all"
              >
                <Zap className="w-4 h-4" />
                {processMode === "realtime"
                  ? isVi
                    ? "Tải lên & bắt đầu Realtime"
                    : "Upload & Start Realtime"
                  : isVi
                  ? "Tải lên & tạo phụ đề"
                  : "Upload & Generate Subtitles"}
              </button>
            )}

            {/* Format Tips */}
            <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-2xl p-4 flex gap-3">
              <div className="w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/40 flex items-center justify-center flex-shrink-0">
                <AlertCircle className="w-4 h-4 text-blue-600" />
              </div>
              <div>
                <p className="text-sm text-blue-700 dark:text-blue-200 mb-0.5">{isVi ? "Mẹo để có kết quả tốt" : "Best results tip"}</p>
                <p className="text-xs text-blue-500 dark:text-blue-100/90 leading-relaxed">
                  {isVi
                    ? "Để đạt độ chính xác cao, hãy đảm bảo video có âm thanh rõ và ít tạp âm. Hỗ trợ: MP4, MOV, MKV, AVI, WEBM · Dung lượng tối đa: 2 GB · Thời lượng tối đa: 4 giờ."
                    : "For best accuracy, ensure your video has clear audio with minimal background noise. Supported: MP4, MOV, MKV, AVI, WEBM · Max size: 2 GB · Max duration: 4 hours."}
                </p>
              </div>
            </div>
          </div>

          {/* Settings Sidebar */}
          <div className="space-y-4">
            {/* Language Selection */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 shadow-sm">
              <h3 className="text-sm text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                <Languages className="w-4 h-4 text-violet-500" />
                {isVi ? "Ngôn ngữ" : "Language"}
              </h3>
              <div className="relative">
                <button
                  onClick={() => setLangOpen(!langOpen)}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                >
                  <span>{LANGUAGES.find((lang) => lang.id === language)?.[isVi ? "vi" : "en"] ?? "English only"}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${langOpen ? "rotate-180" : ""}`} />
                </button>
                <AnimatePresence>
                  {langOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      className="absolute top-full mt-1 left-0 right-0 bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg z-20 max-h-48 overflow-y-auto"
                    >
                      {LANGUAGES.map((lang) => (
                        <button
                          key={lang.id}
                          onClick={() => { setLanguage(lang.id); setLangOpen(false); }}
                          className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                            language === lang.id
                              ? "text-violet-700 dark:text-violet-200 bg-violet-50 dark:bg-violet-900/30"
                              : "text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800"
                          }`}
                        >
                          {isVi ? lang.vi : lang.en}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              <p className="text-xs text-gray-400 dark:text-gray-300 mt-2">
                {isVi
                  ? "Chọn ngôn ngữ của video để nhận phụ đề song ngữ"
                  : "Select the video language to receive bilingual subtitles"}
              </p>
            </div>

            {/* Mode Selector */}
            <div className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-2xl p-4 shadow-sm">
              <h3 className="text-sm text-gray-900 dark:text-gray-100 mb-3 flex items-center gap-2">
                <Zap className="w-4 h-4 text-violet-500" />
                {isVi ? "Chế độ phụ đề" : "Subtitle Mode"}
              </h3>
              <div className="space-y-2">
                {/* Usage counter for free users */}
                {!isPremium && (
                  <div className="flex items-center justify-between px-1 mb-1">
                    <span className="text-xs text-gray-500 dark:text-gray-400">
                      {isVi ? "Video đã dùng tháng này:" : "Videos used this month:"}
                    </span>
                    <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">
                      {profile?.videos_used_this_month ?? 0}/5
                    </span>
                  </div>
                )}

                {/* Upload error */}
                {uploadError && (
                  <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-red-50 border border-red-200 text-red-600 text-xs mb-1">
                    <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                    <span>{uploadError}</span>
                    {uploadError.includes("limit") || uploadError.includes("giới hạn") ? (
                      <Link to="/upgrade" className="ml-auto shrink-0 font-semibold underline">{isVi ? "Nâng cấp" : "Upgrade"}</Link>
                    ) : null}
                  </div>
                )}

                {[
                  {
                    id: "normal",
                    label: isVi ? "Thường" : "Normal",
                    desc: isVi ? "Chờ xử lý xong mới vào Editor" : "Enter Editor after processing completes",
                    badge: isVi ? "Mặc định" : "Default",
                    locked: false,
                  },
                  {
                    id: "realtime",
                    label: "Realtime",
                    desc: isVi ? "Vào Editor ngay, không cần đợi" : "Enter Editor immediately, no waiting",
                    badge: isPremium ? "Beta" : "Premium",
                    locked: !isPremium,
                  },
                ].map((mode) => (
                  <label
                    key={mode.id}
                    className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-colors ${
                      mode.locked
                        ? "opacity-60 cursor-not-allowed border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800"
                        : processMode === mode.id
                        ? "border-violet-300 bg-violet-50 dark:bg-violet-900/30 dark:border-violet-700 cursor-pointer"
                        : "border-gray-100 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer"
                    }`}
                  >
                    {mode.locked ? (
                      <Lock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                    ) : (
                      <input
                        type="radio"
                        name="subtitle-mode"
                        value={mode.id}
                        checked={processMode === mode.id}
                        onChange={() => setProcessMode(mode.id as ProcessMode)}
                        className="accent-violet-600"
                      />
                    )}
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-700 dark:text-gray-100">{mode.label}</span>
                        {mode.badge && (
                          <span
                            className={`text-xs px-1.5 py-0.5 rounded-md flex items-center gap-1 ${
                              mode.locked
                                ? "bg-amber-100 text-amber-700"
                                : mode.id === "realtime"
                                ? "bg-amber-100 text-amber-700"
                                : "bg-green-100 text-green-700"
                            }`}
                          >
                            {mode.locked && <Crown className="w-2.5 h-2.5" />}
                            {mode.badge}
                          </span>
                        )}
                      </div>
                    </div>
                    <span className="text-[11px] text-gray-400 dark:text-gray-300 text-right max-w-32">{mode.desc}</span>
                  </label>
                ))}
              </div>
              
            </div>

            {/* Quick Stats */}
            <div className="bg-gradient-to-br from-violet-600 to-indigo-700 rounded-2xl p-4 text-white">
              <h3 className="text-sm text-violet-100 mb-4">{isVi ? "Vì sao chọn SubAI?" : "Why choose SubAI?"}</h3>
              <div className="space-y-3">
                {[
                  { icon: CheckCircle2, label: isVi ? "Miễn phí để bắt đầu, không cần thẻ" : "Free to start, no credit card" },
                  { icon: Clock, label: isVi ? "Có kết quả trong dưới 2 phút" : "Results in under 2 min" },
                  { icon: Zap, label: isVi ? "Nhanh hơn thủ công 36 lần" : "36× faster than manual" },
                  { icon: Sparkles, label: isVi ? "Premium chỉ 99k₫/năm" : "Premium at 99k₫/year" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2.5">
                    <item.icon className="w-4 h-4 text-violet-300 flex-shrink-0" />
                    <span className="text-sm text-violet-100">{item.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
