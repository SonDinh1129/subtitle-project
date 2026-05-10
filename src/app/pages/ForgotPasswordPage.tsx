import { useState, useRef, useEffect } from "react";
import { Link, useNavigate } from "react-router";
import { motion, AnimatePresence } from "motion/react";
import { Captions, ArrowLeft, Mail, CheckCircle2, ArrowRight, RefreshCw, Eye, EyeOff } from "lucide-react";
import { AuthRightPanel } from "../components/AuthRightPanel";
import { useUiPreferences } from "../context/UiPreferencesContext";
import { supabase } from "../../lib/supabase";

type Stage = "form" | "otp" | "new-password";

export function ForgotPasswordPage() {
  const { language } = useUiPreferences();
  const isVi = language === "vi";
  const navigate = useNavigate();
  const [stage, setStage] = useState<Stage>("form");
  const [email, setEmail] = useState("");
  const [emailError, setEmailError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [countdown, setCountdown] = useState(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [otp, setOtp] = useState("");
  const [otpError, setOtpError] = useState<string | null>(null);
  const [otpLoading, setOtpLoading] = useState(false);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordErrors, setPasswordErrors] = useState<{ newPassword?: string; confirmPassword?: string }>({});
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const validate = () => {
    if (!email) return isVi ? "Email là bắt buộc" : "Email is required";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return isVi ? "Vui lòng nhập địa chỉ email hợp lệ" : "Enter a valid email address";
    return "";
  };

  const startCountdown = () => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    setCountdown(60);
    countdownRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          if (countdownRef.current) clearInterval(countdownRef.current);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const err = validate();
    if (err) { setEmailError(err); return; }
    setEmailError("");
    setIsLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    setIsLoading(false);
    if (error) {
      if (error.status === 429) {
        setEmailError(isVi ? "Quá nhiều yêu cầu, vui lòng thử lại sau." : "Too many requests, please try again later.");
        return;
      }
      // For other errors, still transition to OTP to prevent email enumeration
    }
    setStage("otp");
    startCountdown();
  };

  const handleResend = async () => {
    if (countdown > 0) return;
    setIsLoading(true);
    await supabase.auth.resetPasswordForEmail(email);
    setIsLoading(false);
    startCountdown();
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!otp.trim()) {
      setOtpError(isVi ? "Vui lòng nhập mã OTP" : "Please enter the OTP code");
      return;
    }
    setOtpError(null);
    setOtpLoading(true);
    try {
      const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'recovery' });
      if (error) {
        setOtpError(isVi ? "Mã OTP không hợp lệ hoặc đã hết hạn." : "Invalid or expired OTP code.");
      } else {
        setStage("new-password");
      }
    } catch {
      setOtpError(isVi ? "Đã xảy ra lỗi, vui lòng thử lại." : "An error occurred, please try again.");
    } finally {
      setOtpLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs: typeof passwordErrors = {};
    if (!newPassword) errs.newPassword = isVi ? "Mật khẩu là bắt buộc" : "Password is required";
    else if (newPassword.length < 8) errs.newPassword = isVi ? "Mật khẩu phải có ít nhất 8 ký tự" : "Password must be at least 8 characters";
    if (!confirmPassword) errs.confirmPassword = isVi ? "Vui lòng xác nhận mật khẩu" : "Please confirm your password";
    else if (newPassword !== confirmPassword) errs.confirmPassword = isVi ? "Mật khẩu không khớp" : "Passwords do not match";
    if (Object.keys(errs).length > 0) { setPasswordErrors(errs); return; }
    setPasswordErrors({});
    setPasswordError(null);
    setPasswordLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordError(error.message);
        // Do NOT reset stage — keep user on 'new-password'
      } else {
        navigate("/upload", { replace: true });
      }
    } catch {
      setPasswordError(isVi ? "Đã xảy ra lỗi, vui lòng thử lại." : "An error occurred, please try again.");
    } finally {
      setPasswordLoading(false);
    }
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
            ) : stage === "otp" ? (
              <motion.div
                key="otp"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
              >
                <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center mb-5">
                  <Mail className="w-6 h-6 text-violet-600" />
                </div>
                <h1 className="text-gray-900 dark:text-gray-100 mb-1.5" style={{ fontSize: "1.625rem", fontWeight: 700, lineHeight: 1.25 }}>
                  {isVi ? "Nhập mã xác minh" : "Enter verification code"}
                </h1>
                <p className="text-gray-500 mb-2" style={{ fontSize: "0.9375rem" }}>
                  {isVi ? "Chúng tôi đã gửi mã 6 số đến" : "We sent a 6-digit code to"}
                </p>
                <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-violet-50 border border-violet-100 mb-6">
                  <Mail className="w-4 h-4 text-violet-500" />
                  <span className="text-violet-700" style={{ fontSize: "0.9375rem", fontWeight: 600 }}>{email}</span>
                </div>

                <form onSubmit={handleVerifyOtp} className="space-y-4">
                  <div>
                    <label className="block text-gray-700 mb-1.5" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                      {isVi ? "Mã xác minh" : "Verification Code"}
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      placeholder="123456"
                      value={otp}
                      onChange={(e) => { setOtp(e.target.value.replace(/\D/g, '')); setOtpError(null); }}
                      className={`w-full px-4 py-2.5 rounded-xl border bg-white text-gray-900 placeholder-gray-400 outline-none transition-all tracking-widest text-center text-lg
                        ${otpError
                          ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
                          : "border-gray-200 hover:border-gray-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                        }`}
                    />
                    {otpError && <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{otpError}</p>}
                  </div>

                  <button
                    type="submit"
                    disabled={otpLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-md shadow-violet-200"
                    style={{ fontSize: "0.9375rem", fontWeight: 600 }}
                  >
                    {otpLoading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {isVi ? "Đang xác minh..." : "Verifying..."}
                      </>
                    ) : (
                      <>
                        {isVi ? "Xác minh" : "Verify"}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                <button
                  onClick={handleResend}
                  disabled={countdown > 0 || isLoading}
                  className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                  style={{ fontSize: "0.9375rem", fontWeight: 500 }}
                >
                  <RefreshCw className="w-4 h-4" />
                  {countdown > 0
                    ? (isVi ? `Gửi lại sau ${countdown}s` : `Resend in ${countdown}s`)
                    : (isVi ? "Gửi lại mã" : "Resend code")}
                </button>
              </motion.div>
            ) : (
              /* stage === "new-password" — no back links, implicit login is active */
              <motion.div
                key="new-password"
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -12 }}
                transition={{ duration: 0.35 }}
              >
                <div className="w-12 h-12 rounded-2xl bg-emerald-50 flex items-center justify-center mb-5">
                  <CheckCircle2 className="w-6 h-6 text-emerald-600" />
                </div>
                <h1 className="text-gray-900 dark:text-gray-100 mb-1.5" style={{ fontSize: "1.625rem", fontWeight: 700, lineHeight: 1.25 }}>
                  {isVi ? "Tạo mật khẩu mới" : "Create new password"}
                </h1>
                <p className="text-gray-500 mb-8" style={{ fontSize: "0.9375rem" }}>
                  {isVi ? "Nhập mật khẩu mới cho tài khoản của bạn." : "Enter a new password for your account."}
                </p>

                {passwordError && (
                  <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
                    {passwordError}
                  </div>
                )}

                <form onSubmit={handleUpdatePassword} className="space-y-4">
                  <div>
                    <label className="block text-gray-700 mb-1.5" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                      {isVi ? "Mật khẩu mới" : "New Password"}
                    </label>
                    <div className="relative">
                      <input
                        type={showNewPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder={isVi ? "Tối thiểu 8 ký tự" : "Min. 8 characters"}
                        value={newPassword}
                        onChange={(e) => { setNewPassword(e.target.value); setPasswordErrors((p) => ({ ...p, newPassword: undefined })); }}
                        className={`w-full px-4 py-2.5 pr-12 rounded-xl border bg-white text-gray-900 placeholder-gray-400 outline-none transition-all
                          ${passwordErrors.newPassword
                            ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
                            : "border-gray-200 hover:border-gray-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                          }`}
                        style={{ fontSize: "0.9375rem" }}
                      />
                      <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-0.5">
                        {showNewPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                    {passwordErrors.newPassword && <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{passwordErrors.newPassword}</p>}
                  </div>

                  <div>
                    <label className="block text-gray-700 mb-1.5" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                      {isVi ? "Xác nhận mật khẩu" : "Confirm Password"}
                    </label>
                    <div className="relative">
                      <input
                        type={showConfirmPassword ? "text" : "password"}
                        autoComplete="new-password"
                        placeholder={isVi ? "Nhập lại mật khẩu" : "Re-enter password"}
                        value={confirmPassword}
                        onChange={(e) => { setConfirmPassword(e.target.value); setPasswordErrors((p) => ({ ...p, confirmPassword: undefined })); }}
                        className={`w-full px-4 py-2.5 pr-12 rounded-xl border bg-white text-gray-900 placeholder-gray-400 outline-none transition-all
                          ${passwordErrors.confirmPassword
                            ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
                            : "border-gray-200 hover:border-gray-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                          }`}
                        style={{ fontSize: "0.9375rem" }}
                      />
                      <button type="button" onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-0.5">
                        {showConfirmPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                      </button>
                    </div>
                    {passwordErrors.confirmPassword && <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{passwordErrors.confirmPassword}</p>}
                  </div>

                  <button
                    type="submit"
                    disabled={passwordLoading}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-md shadow-violet-200 mt-2"
                    style={{ fontSize: "0.9375rem", fontWeight: 600 }}
                  >
                    {passwordLoading ? (
                      <>
                        <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {isVi ? "Đang cập nhật..." : "Updating..."}
                      </>
                    ) : (
                      <>
                        {isVi ? "Cập nhật mật khẩu" : "Update Password"}
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>
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
