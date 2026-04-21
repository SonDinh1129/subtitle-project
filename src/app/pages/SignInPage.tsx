import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "motion/react";
import {
  Captions,
  Eye,
  EyeOff,
  ArrowRight,
} from "lucide-react";
import { AuthRightPanel } from "../components/AuthRightPanel";
import { useUiPreferences } from "../context/UiPreferencesContext";
import { signInWithGoogle } from "../../lib/supabase";

export function SignInPage() {
  const navigate = useNavigate();
  const { language } = useUiPreferences();
  const isVi = language === "vi";
  const [showPassword, setShowPassword] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [oauthLoading, setOauthLoading] = useState(false);
  const [errors, setErrors] = useState<{ email?: string; password?: string }>({});
  const [authError, setAuthError] = useState<string | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);

  const validate = () => {
    const newErrors: { email?: string; password?: string } = {};
    if (!email) newErrors.email = isVi ? "Email là bắt buộc" : "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      newErrors.email = isVi ? "Vui lòng nhập địa chỉ email hợp lệ" : "Enter a valid email address";
    if (!password) newErrors.password = isVi ? "Mật khẩu là bắt buộc" : "Password is required";
    else if (password.length < 6)
      newErrors.password = isVi ? "Mật khẩu phải có ít nhất 6 ký tự" : "Password must be at least 6 characters";
    return newErrors;
  };

  const handleGoogleSignIn = async () => {
    setOauthLoading(true);
    setOauthError(null);
    const { error } = await signInWithGoogle();
    if (error) {
      setOauthError(error);
      setOauthLoading(false);
    }
    // On success the browser redirects — no need to reset loading
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors = validate();
    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});
    setAuthError(null);
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        setAuthError(isVi ? "Email hoặc mật khẩu không đúng" : "Invalid email or password");
      } else {
        navigate("/upload");
      }
    } catch {
      setAuthError(isVi ? "Đã xảy ra lỗi, vui lòng thử lại" : "An error occurred, please try again");
    } finally {
      setIsLoading(false);
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

          {/* Heading */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <h1 className="text-gray-900 dark:text-gray-100 mb-1.5" style={{ fontSize: "1.625rem", fontWeight: 700, lineHeight: 1.25 }}>
              {isVi ? "Chào mừng trở lại" : "Welcome back"}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mb-8" style={{ fontSize: "0.9375rem" }}>
              {isVi
                ? "Đăng nhập để tiếp tục với workspace phụ đề tiếng Anh."
                : "Sign in to continue your English subtitle translation workspace."}
            </p>
          </motion.div>

          {/* Social Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="flex flex-col gap-3 mb-6"
          >
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={oauthLoading}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 hover:border-gray-300 dark:hover:border-gray-600 disabled:opacity-60 disabled:cursor-not-allowed transition-all shadow-sm"
              style={{ fontSize: "0.9375rem", fontWeight: 500 }}
            >
              {oauthLoading ? (
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : (
                <GoogleIcon />
              )}
              {isVi ? "Tiếp tục với Google" : "Continue with Google"}
            </button>
            {oauthError && (
              <p className="text-red-500 text-center" style={{ fontSize: "0.8125rem" }}>{oauthError}</p>
            )}
          </motion.div>

          {/* Divider */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex items-center gap-3 mb-6"
          >
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
            <span className="text-gray-400 dark:text-gray-500 whitespace-nowrap" style={{ fontSize: "0.8125rem" }}>
              {isVi ? "hoặc tiếp tục với email" : "or continue with email"}
            </span>
            <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
          </motion.div>

          {/* Auth error */}
          {authError && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
              {authError}
            </div>
          )}

          {/* Form */}
          <motion.form
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            {/* Email */}
            <div>
              <label className="block text-gray-700 mb-1.5" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                {isVi ? "Email công việc" : "Work Email Address"}
              </label>
              <input
                type="email"
                autoComplete="email"
                placeholder="you@company.com"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setErrors((p) => ({ ...p, email: undefined })); }}
                className={`w-full px-4 py-2.5 rounded-xl border bg-white text-gray-900 placeholder-gray-400 outline-none transition-all
                  ${errors.email
                    ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
                    : "border-gray-200 hover:border-gray-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  }`}
                style={{ fontSize: "0.9375rem" }}
              />
              {errors.email && (
                <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{errors.email}</p>
              )}
            </div>

            {/* Password */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-gray-700" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                  {isVi ? "Mật khẩu" : "Password"}
                </label>
                <Link
                  to="/forgot-password"
                  className="text-violet-600 hover:text-violet-700 transition-colors"
                  style={{ fontSize: "0.8125rem", fontWeight: 500 }}
                >
                  {isVi ? "Quên mật khẩu?" : "Forgot password?"}
                </Link>
              </div>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setErrors((p) => ({ ...p, password: undefined })); }}
                  className={`w-full px-4 py-2.5 pr-12 rounded-xl border bg-white text-gray-900 placeholder-gray-400 outline-none transition-all
                    ${errors.password
                      ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      : "border-gray-200 hover:border-gray-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                    }`}
                  style={{ fontSize: "0.9375rem" }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-0.5"
                >
                  {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>
              {errors.password && (
                <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{errors.password}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-md shadow-violet-200 hover:shadow-lg hover:shadow-violet-200 active:scale-[0.99] mt-2"
              style={{ fontSize: "0.9375rem", fontWeight: 600 }}
            >
              {isLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {isVi ? "Đang đăng nhập..." : "Signing in..."}
                </>
              ) : (
                <>
                  {isVi ? "Đăng nhập" : "Sign In"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </motion.form>

          {/* Footer */}
          <motion.p
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.25 }}
            className="mt-8 text-center text-gray-500"
            style={{ fontSize: "0.875rem" }}
          >
            {isVi ? "Chưa có tài khoản?" : "Don't have an account?"}{" "}
            <Link to="/signup" className="text-violet-600 hover:text-violet-700 transition-colors" style={{ fontWeight: 600 }}>
              {isVi ? "Đăng ký miễn phí" : "Sign up free"}
            </Link>
          </motion.p>
        </div>
      </div>

      {/* ── Right: Visual Panel ── */}
      <AuthRightPanel />
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
      <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4" />
      <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853" />
      <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05" />
      <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335" />
    </svg>
  );
}

