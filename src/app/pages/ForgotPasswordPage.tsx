import { useState } from "react";
import { Link } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { Captions, ArrowLeft, Mail, CheckCircle2, ArrowRight, RefreshCw } from "lucide-react";
import { AuthRightPanel } from "../components/AuthRightPanel";
import { useUiPreferences } from "../context/UiPreferencesContext";

type Stage = "form" | "sent";

export function ForgotPasswordPage() {
  const { language } = useUiPreferences();
  const isVi = language === "vi";
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);

  const validate = () => {
    if (!email) return isVi ? "Email là bắt buộc" : "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return isVi ? "Vui lòng nhập địa chỉ email hợp lệ" : "Enter a valid email address";
    return "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setEmailError(err); return; }
    setEmailError("");
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 1200));
    setIsLoading(false);
    setStage("sent");
    startCountdown();
  };

  const startCountdown = () => {
    setCountdown(60);
    const iv = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) { clearInterval(iv); return 0; }
        return c - 1;
      });
    }, 1000);
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setIsLoading(true);
    await new Promise((r) => setTimeout(r, 800));
    setIsLoading(false);
    startCountdown();
  };

  return (
    <div className="min-h-screen flex bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* ── Left: Auth Form ── */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 bg-white dark:bg-gray-950 lg:max-w-[52%]">
        <div className="w-full max-w-[420px]">
          {/* Logo */}
          <Link to="/" className="inline-flex items-center gap-2.5 group mb-10">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-200 group-hover:shadow-violet-300 transition-shadow">
              <Captions className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-gray-900 dark:text-gray-100 tracking-tight">
              <span className="text-violet-600">Sub</span>AI
            </span>
          </Link>

          <AnimatePresence mode="wait">
            {stage === "form" ? (
              <motion.div
                key="form"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
              >
                {/* Back */}
                <Link
                  to="/signin"
                  className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 transition-colors mb-6 group"
                  style={{ fontSize: "0.875rem" }}
                >
                  <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                  {isVi ? "Quay lại đăng nhập" : "Back to sign in"}
                </Link>

                {/* Icon */}
                <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center mb-5">
                  <Mail className="w-6 h-6 text-violet-600" />
                </div>

                {/* Heading */}
                <h1 className="text-gray-900 dark:text-gray-100 mb-1.5" style={{ fontSize: "1.625rem", fontWeight: 700, lineHeight: 1.25 }}>
                  {isVi ? "Đặt lại mật khẩu" : "Reset your password"}
                </h1>
                <p className="text-gray-500 mb-8" style={{ fontSize: "0.9375rem", lineHeight: 1.6 }}>
                  {isVi
                    ? "Nhập email gắn với workspace phụ đề tiếng Anh, chúng tôi sẽ gửi liên kết đặt lại cho bạn."
                    : "Enter the email associated with your English subtitle workspace and we'll send you a reset link."}
                </p>

                {/* Form */}
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-gray-700 mb-1.5" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                      {isVi ? "Địa chỉ email" : "Email Address"}
                    </label>
                    <input
                      type="email"
                      autoComplete="email"
                      placeholder="you@company.com"
                      value={email}
                      onChange={(e) => { setEmail(e.target.value); setEmailError(""); }}
                      className={`w-full px-4 py-2.5 rounded-xl border bg-white text-gray-900 placeholder-gray-400 outline-none transition-all
                        ${emailError
                          ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
                          : "border-gray-200 hover:border-gray-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                        }`}
                      style={{ fontSize: "0.9375rem" }}
                    />
                    {emailError && (
                      <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{emailError}</p>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={isLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-md shadow-violet-200 hover:shadow-lg hover:shadow-violet-200 active:scale-[0.99]"
                    style={{ fontSize: "0.9375rem", fontWeight: 600 }}
                  >
                    {isLoading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {isVi ? "Đang gửi liên kết..." : "Sending link..."}
                      </>
                    ) : (
                      <>
                        {isVi ? "Gửi liên kết đặt lại" : "Send Reset Link"}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                {/* Info box */}
                <div className="mt-6 p-4 rounded-xl bg-blue-50 border border-blue-100 flex gap-3">
                  <div className="shrink-0 mt-0.5">
                    <svg className="w-4 h-4 text-blue-500" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <p className="text-blue-700" style={{ fontSize: "0.8125rem", lineHeight: 1.6 }}>
                    {isVi
                      ? "Chúng tôi sẽ gửi liên kết đặt lại vào hộp thư của bạn. Hãy kiểm tra cả mục spam nếu chưa thấy trong 1 phút."
                      : "We'll send a reset link to your inbox. Check spam if you do not see it within a minute."}
                  </p>
                </div>

                <p className="mt-7 text-center text-gray-500" style={{ fontSize: "0.875rem" }}>
                  {isVi ? "Nhớ mật khẩu rồi?" : "Remember your password?"}{" "}
                  <Link to="/signin" className="text-violet-600 hover:text-violet-700 transition-colors" style={{ fontWeight: 600 }}>
                    {isVi ? "Đăng nhập" : "Sign in"}
                  </Link>
                </p>
              </motion.div>
            ) : (
              <motion.div
                key="sent"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.4 }}
              >
                {/* Success state */}
                <div className="text-center">
                  {/* Animated check */}
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ type: "spring", stiffness: 260, damping: 20, delay: 0.1 }}
                    className="w-20 h-20 rounded-full bg-emerald-50 border-4 border-emerald-100 flex items-center justify-center mx-auto mb-6"
                  >
                    <CheckCircle2 className="w-10 h-10 text-emerald-500" />
                  </motion.div>

                  <h1 className="text-gray-900 dark:text-gray-100 mb-3" style={{ fontSize: "1.625rem", fontWeight: 700, lineHeight: 1.25 }}>
                    {isVi ? "Kiểm tra hộp thư" : "Check your inbox"}
                  </h1>
                  <p className="text-gray-500 mb-2" style={{ fontSize: "0.9375rem", lineHeight: 1.6 }}>
                    {isVi ? "Chúng tôi đã gửi liên kết đặt lại mật khẩu tới:" : "We sent a password reset link to:"}
                  </p>
                  <div className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-violet-50 border border-violet-100 mb-8">
                    <Mail className="w-4 h-4 text-violet-500" />
                    <span className="text-violet-700" style={{ fontSize: "0.9375rem", fontWeight: 600 }}>
                      {email}
                    </span>
                  </div>

                  {/* Steps */}
                  <div className="text-left space-y-3 mb-8">
                    {(isVi
                      ? [
                          "Mở email từ SubAI",
                          "Nhấn vào liên kết \"Đặt lại mật khẩu\"",
                          "Tạo mật khẩu mới",
                        ]
                      : [
                          "Open the email from SubAI",
                          "Click the \"Reset password\" link",
                          "Create your new password",
                        ]).map((step, i) => (
                      <div key={step} className="flex items-center gap-3">
                        <div className="w-6 h-6 rounded-full bg-violet-100 flex items-center justify-center shrink-0">
                          <span className="text-violet-600" style={{ fontSize: "0.75rem", fontWeight: 700 }}>{i + 1}</span>
                        </div>
                        <span className="text-gray-600" style={{ fontSize: "0.875rem" }}>{step}</span>
                      </div>
                    ))}
                  </div>

                  {/* Resend */}
                  <button
                    onClick={handleResend}
                    disabled={countdown > 0 || isLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 hover:border-gray-300 disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-sm"
                    style={{ fontSize: "0.9375rem", fontWeight: 500 }}
                  >
                    {isLoading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {isVi ? "Đang gửi..." : "Sending..."}
                      </>
                    ) : countdown > 0 ? (
                      <>
                        <RefreshCw className="w-4 h-4 text-gray-400" />
                        {isVi ? `Gửi lại sau ${countdown}s` : `Resend in ${countdown}s`}
                      </>
                    ) : (
                      <>
                        <RefreshCw className="w-4 h-4" />
                        {isVi ? "Gửi lại email" : "Resend email"}
                      </>
                    )}
                  </button>

                  <div className="mt-5">
                    <Link
                      to="/signin"
                      className="inline-flex items-center gap-1.5 text-gray-500 hover:text-gray-700 transition-colors group"
                      style={{ fontSize: "0.875rem" }}
                    >
                      <ArrowLeft className="w-4 h-4 group-hover:-translate-x-0.5 transition-transform" />
                      {isVi ? "Quay lại đăng nhập" : "Back to sign in"}
                    </Link>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Right: Visual Panel ── */}
      <AuthRightPanel />
    </div>
  );
}
