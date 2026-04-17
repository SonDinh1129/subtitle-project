import { useState } from "react";
import { useNavigate, Link } from "react-router";
import { motion } from "motion/react";
import { Captions, Eye, EyeOff, ArrowRight } from "lucide-react";
import { AuthRightPanel } from "../components/AuthRightPanel";
import { useUiPreferences } from "../context/UiPreferencesContext";
import { supabase } from "../../lib/supabase";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const { language } = useUiPreferences();
  const isVi = language === "vi";
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});
  const [authError, setAuthError] = useState<string | null>(null);

  const validate = () => {
    const e: typeof errors = {};
    if (!password) e.password = isVi ? "Mật khẩu là bắt buộc" : "Password is required";
    else if (password.length < 8) e.password = isVi ? "Mật khẩu phải có ít nhất 8 ký tự" : "Password must be at least 8 characters";
    if (!confirm) e.confirm = isVi ? "Vui lòng xác nhận mật khẩu" : "Please confirm your password";
    else if (password !== confirm) e.confirm = isVi ? "Mật khẩu không khớp" : "Passwords do not match";
    return e;
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
      const { error } = await supabase.auth.updateUser({ password });
      if (error) {
        setAuthError(error.message);
      } else {
        navigate("/upload", { replace: true });
      }
    } catch {
      setAuthError(isVi ? "Đã xảy ra lỗi, vui lòng thử lại" : "An error occurred, please try again");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* ── Left: Form ── */}
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

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
          >
            <h1 className="text-gray-900 dark:text-gray-100 mb-1.5" style={{ fontSize: "1.625rem", fontWeight: 700, lineHeight: 1.25 }}>
              {isVi ? "Tạo mật khẩu mới" : "Create new password"}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mb-8" style={{ fontSize: "0.9375rem" }}>
              {isVi ? "Nhập mật khẩu mới cho tài khoản của bạn." : "Enter a new password for your account."}
            </p>
          </motion.div>

          {authError && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
              {authError}
            </div>
          )}

          <motion.form
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            {/* New password */}
            <div>
              <label className="block text-gray-700 mb-1.5" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                {isVi ? "Mật khẩu mới" : "New Password"}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={isVi ? "Tối thiểu 8 ký tự" : "Min. 8 characters"}
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

            {/* Confirm password */}
            <div>
              <label className="block text-gray-700 mb-1.5" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                {isVi ? "Xác nhận mật khẩu" : "Confirm Password"}
              </label>
              <div className="relative">
                <input
                  type={showConfirm ? "text" : "password"}
                  autoComplete="new-password"
                  placeholder={isVi ? "Nhập lại mật khẩu" : "Re-enter password"}
                  value={confirm}
                  onChange={(e) => { setConfirm(e.target.value); setErrors((p) => ({ ...p, confirm: undefined })); }}
                  className={`w-full px-4 py-2.5 pr-12 rounded-xl border bg-white text-gray-900 placeholder-gray-400 outline-none transition-all
                    ${errors.confirm
                      ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
                      : "border-gray-200 hover:border-gray-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                    }`}
                  style={{ fontSize: "0.9375rem" }}
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors p-0.5"
                >
                  {showConfirm ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>
              {errors.confirm && (
                <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{errors.confirm}</p>
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
                  {isVi ? "Đang cập nhật..." : "Updating..."}
                </>
              ) : (
                <>
                  {isVi ? "Cập nhật mật khẩu" : "Update Password"}
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </motion.form>
        </div>
      </div>

      {/* ── Right: Visual Panel ── */}
      <AuthRightPanel />
    </div>
  );
}
