import { useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { Captions, Eye, EyeOff, ArrowRight, CheckCircle2 } from "lucide-react";
import { AuthRightPanel } from "../components/AuthRightPanel";
import { useUiPreferences } from "../context/UiPreferencesContext";
import { supabase } from "../../lib/supabase";

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

function GitHubIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" className="text-gray-800">
      <path d="M12 0C5.374 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

function PasswordStrength({ password, isVi }: { password: string; isVi: boolean }) {
  const getStrength = () => {
    if (!password) return 0;
    let score = 0;
    if (password.length >= 8) score++;
    if (/[A-Z]/.test(password)) score++;
    if (/[0-9]/.test(password)) score++;
    if (/[^A-Za-z0-9]/.test(password)) score++;
    return score;
  };

  const strength = getStrength();
  const labels = isVi
    ? ["", "Yếu", "Tạm ổn", "Tốt", "Mạnh"]
    : ["", "Weak", "Fair", "Good", "Strong"];
  const colors = ["", "bg-red-400", "bg-amber-400", "bg-emerald-400", "bg-emerald-500"];
  const textColors = ["", "text-red-500", "text-amber-500", "text-emerald-600", "text-emerald-600"];

  if (!password) return null;

  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-all duration-300 ${
              i <= strength ? colors[strength] : "bg-gray-200"
            }`}
          />
        ))}
      </div>
      {strength > 0 && (
        <p className={`${textColors[strength]}`} style={{ fontSize: "0.75rem", fontWeight: 500 }}>
          {labels[strength]} {isVi ? "mật khẩu" : "password"}
        </p>
      )}
    </div>
  );
}

export function SignUpPage() {
  const { language } = useUiPreferences();
  const isVi = language === "vi";
  const [showPassword, setShowPassword] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [signUpSuccess, setSignUpSuccess] = useState(false);
  const [errors, setErrors] = useState<{
    fullName?: string;
    email?: string;
    password?: string;
    agreed?: string;
  }>({});

  const validate = () => {
    const e: typeof errors = {};
    if (!fullName.trim()) e.fullName = isVi ? "Họ và tên là bắt buộc" : "Full name is required";
    if (!email) e.email = isVi ? "Email là bắt buộc" : "Email is required";
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) e.email = isVi ? "Vui lòng nhập địa chỉ email hợp lệ" : "Enter a valid email address";
    if (!password) e.password = isVi ? "Mật khẩu là bắt buộc" : "Password is required";
    else if (password.length < 8) e.password = isVi ? "Mật khẩu phải có ít nhất 8 ký tự" : "Password must be at least 8 characters";
    if (!agreed) e.agreed = isVi ? "Vui lòng đồng ý điều khoản để tiếp tục" : "Please accept the terms to continue";
    return e;
  };

  const handleOAuth = async (provider: "google" | "github") => {
    const redirectTo = `${window.location.origin}/upload`;
    await supabase.auth.signInWithOAuth({ provider, options: { redirectTo } });
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
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: fullName } },
      });
      if (error) {
        setAuthError(error.message);
      } else if (data.user && data.user.identities && data.user.identities.length === 0) {
        setAuthError(isVi ? "Email này đã được đăng ký. Vui lòng đăng nhập." : "This email is already registered. Please sign in.");
      } else {
        setSignUpSuccess(true);
      }
    } catch {
      setAuthError(isVi ? "Đã xảy ra lỗi, vui lòng thử lại" : "An error occurred, please try again");
    } finally {
      setIsLoading(false);
    }
  };

  if (signUpSuccess) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
        <div className="max-w-md w-full mx-4 text-center px-6">
          <div className="w-16 h-16 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-8 h-8 text-emerald-600" />
          </div>
          <h2 className="text-xl font-bold mb-2">
            {isVi ? "Kiểm tra email của bạn!" : "Check your email!"}
          </h2>
          <p className="text-gray-500 mb-6" style={{ fontSize: "0.9375rem" }}>
            {isVi
              ? `Chúng tôi đã gửi link xác nhận đến ${email}. Vui lòng kiểm tra và nhấp vào link để hoàn tất đăng ký.`
              : `We sent a confirmation link to ${email}. Please check your inbox and click the link to complete registration.`}
          </p>
          <Link to="/signin" className="text-violet-600 hover:text-violet-700 font-semibold">
            {isVi ? "Quay lại đăng nhập" : "Back to Sign In"}
          </Link>
        </div>
      </div>
    );
  }

  const perks = isVi
    ? [
        "50 phút xử lý tiếng Anh mỗi tháng",
        "Quy trình dịch phụ đề tiếng Anh",
        "Không cần thẻ tín dụng",
      ]
    : [
        "50 minutes of English processing monthly",
        "English subtitle translation workflow",
        "No credit card required",
      ];

  return (
    <div className="min-h-screen flex bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      {/* ── Left: Auth Form ── */}
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 bg-white dark:bg-gray-950 lg:max-w-[52%] overflow-y-auto">
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
              {isVi ? "Tạo tài khoản" : "Create your account"}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 mb-5" style={{ fontSize: "0.9375rem" }}>
              {isVi ? "Bắt đầu tạo phụ đề tiếng Anh chỉ trong vài giây." : "Start generating English subtitles in seconds."}
            </p>

            {/* Perks */}
            <div className="flex flex-wrap gap-x-5 gap-y-1 mb-7">
              {perks.map((perk) => (
                <div key={perk} className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                  <span className="text-gray-500" style={{ fontSize: "0.8125rem" }}>{perk}</span>
                </div>
              ))}
            </div>
          </motion.div>

          {/* Auth error */}
          {authError && (
            <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
              {authError}
            </div>
          )}

          {/* Social Buttons */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.05 }}
            className="flex flex-col gap-3 mb-6"
          >
            <button
              type="button"
              onClick={() => handleOAuth("google")}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
              style={{ fontSize: "0.9375rem", fontWeight: 500 }}
            >
              <GoogleIcon />
              {isVi ? "Tiếp tục với Google" : "Continue with Google"}
            </button>
            <button
              type="button"
              onClick={() => handleOAuth("github")}
              className="w-full flex items-center justify-center gap-3 px-4 py-2.5 rounded-xl border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-all shadow-sm"
              style={{ fontSize: "0.9375rem", fontWeight: 500 }}
            >
              <GitHubIcon />
              {isVi ? "Tiếp tục với GitHub" : "Continue with GitHub"}
            </button>
          </motion.div>

          {/* Divider */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.4, delay: 0.1 }}
            className="flex items-center gap-3 mb-5"
          >
            <div className="flex-1 h-px bg-gray-200" />
            <span className="text-gray-400 whitespace-nowrap" style={{ fontSize: "0.8125rem" }}>
              {isVi ? "hoặc tiếp tục với email" : "or continue with email"}
            </span>
            <div className="flex-1 h-px bg-gray-200" />
          </motion.div>

          {/* Form */}
          <motion.form
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: 0.15 }}
            onSubmit={handleSubmit}
            className="space-y-4"
          >
            {/* Full Name */}
            <div>
              <label className="block text-gray-700 mb-1.5" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                {isVi ? "Họ và tên" : "Full Name"}
              </label>
              <input
                type="text"
                autoComplete="name"
                placeholder={isVi ? "Nguyễn Văn A" : "Alex Johnson"}
                value={fullName}
                onChange={(e) => { setFullName(e.target.value); setErrors((p) => ({ ...p, fullName: undefined })); }}
                className={`w-full px-4 py-2.5 rounded-xl border bg-white text-gray-900 placeholder-gray-400 outline-none transition-all
                  ${errors.fullName
                    ? "border-red-400 focus:border-red-500 focus:ring-2 focus:ring-red-100"
                    : "border-gray-200 hover:border-gray-300 focus:border-violet-500 focus:ring-2 focus:ring-violet-100"
                  }`}
                style={{ fontSize: "0.9375rem" }}
              />
              {errors.fullName && (
                <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{errors.fullName}</p>
              )}
            </div>

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
              <label className="block text-gray-700 mb-1.5" style={{ fontSize: "0.875rem", fontWeight: 500 }}>
                {isVi ? "Mật khẩu" : "Password"}
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
              <PasswordStrength password={password} isVi={isVi} />
              {errors.password && (
                <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{errors.password}</p>
              )}
            </div>

            {/* Terms checkbox */}
            <div>
              <label className="flex items-start gap-3 cursor-pointer group">
                <div className="relative mt-0.5 shrink-0">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => { setAgreed(e.target.checked); setErrors((p) => ({ ...p, agreed: undefined })); }}
                    className="sr-only"
                  />
                  <div
                    className={`w-4.5 h-4.5 rounded-md border-2 flex items-center justify-center transition-all
                      ${agreed
                        ? "bg-violet-600 border-violet-600"
                        : errors.agreed
                          ? "border-red-400 bg-white"
                          : "border-gray-300 bg-white group-hover:border-violet-400"
                      }`}
                    onClick={() => { setAgreed(!agreed); setErrors((p) => ({ ...p, agreed: undefined })); }}
                  >
                    {agreed && (
                      <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 12 10" fill="none">
                        <path d="M1 5l3.5 3.5L11 1" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    )}
                  </div>
                </div>
                <span className="text-gray-600 leading-snug" style={{ fontSize: "0.875rem" }}>
                  {isVi ? "Tôi đồng ý với" : "I agree to the"}{" "}
                  <a href="#" className="text-violet-600 hover:text-violet-700 underline transition-colors">{isVi ? "Điều khoản dịch vụ" : "Terms of Service"}</a>
                  {" "}{isVi ? "và" : "and"}{" "}
                  <a href="#" className="text-violet-600 hover:text-violet-700 underline transition-colors">{isVi ? "Chính sách quyền riêng tư" : "Privacy Policy"}</a>
                </span>
              </label>
              {errors.agreed && (
                <p className="mt-1.5 text-red-500" style={{ fontSize: "0.8125rem" }}>{errors.agreed}</p>
              )}
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white hover:from-violet-700 hover:to-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-md shadow-violet-200 hover:shadow-lg hover:shadow-violet-200 active:scale-[0.99] mt-1"
              style={{ fontSize: "0.9375rem", fontWeight: 600 }}
            >
              {isLoading ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {isVi ? "Đang tạo tài khoản..." : "Creating account..."}
                </>
              ) : (
                <>
                  {isVi ? "Tạo tài khoản" : "Create Account"}
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
            className="mt-7 text-center text-gray-500"
            style={{ fontSize: "0.875rem" }}
          >
            {isVi ? "Đã có tài khoản?" : "Already have an account?"}{" "}
            <Link to="/signin" className="text-violet-600 hover:text-violet-700 transition-colors" style={{ fontWeight: 600 }}>
              {isVi ? "Đăng nhập" : "Sign in"}
            </Link>
          </motion.p>
        </div>
      </div>

      {/* ── Right: Visual Panel ── */}
      <AuthRightPanel />
    </div>
  );
}
