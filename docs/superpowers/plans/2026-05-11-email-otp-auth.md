# Email OTP Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace Supabase magic link emails with 6-digit OTP codes for both Registration and Forgot Password flows.

**Architecture:** All OTP logic runs entirely in the frontend via Supabase JS SDK — no backend (Flask) changes needed. `SignUpPage.tsx` gains a two-step state machine (`form → otp`). `ForgotPasswordPage.tsx` gains a three-step state machine (`form → otp → new-password`). `ResetPasswordPage.tsx` is repurposed as a redirect since the new-password step is now inline in `ForgotPasswordPage.tsx`.

**Tech Stack:** React 18, TypeScript, `@supabase/supabase-js`, `motion/react`, Tailwind CSS, `lucide-react`

---

## Pre-requisite: Supabase Dashboard Configuration

**Do this before running any code — otherwise OTP emails will not be sent.**

1. Go to **Supabase Dashboard → Authentication → Email Templates → Confirm signup**
   - Remove `{{ .ConfirmationURL }}`
   - Replace with: `Your verification code is: <strong>{{ .Token }}</strong> (expires in 15 minutes)`
2. Go to **Authentication → Email Templates → Reset Password**
   - Remove `{{ .ConfirmationURL }}`
   - Replace with: `Your password reset code is: <strong>{{ .Token }}</strong> (expires in 15 minutes)`
3. Go to **Authentication → Settings → OTP Expiry** → set to `900` (15 minutes)

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/pages/SignUpPage.tsx` | Modify | Add `step` state + OTP input step |
| `src/app/pages/ForgotPasswordPage.tsx` | Modify | Add `otp` + `new-password` steps, remove `redirectTo` |
| `src/app/pages/ResetPasswordPage.tsx` | Modify | Redirect to `/forgot-password` (flow now inline) |

---

## Task 1: SignUpPage — Add OTP Step

**Files:**
- Modify: `src/app/pages/SignUpPage.tsx`

### What changes
- Replace `signUpSuccess: boolean` state with `step: 'form' | 'otp'`
- After `signUp()` success → set `step = 'otp'` (keep `email` in state)
- Add OTP input UI rendered when `step === 'otp'`
- Add `handleVerifyOtp` that calls `supabase.auth.verifyOtp({ email, token, type: 'signup' })`
- Add `handleResend` that calls `supabase.auth.resend({ type: 'signup', email })` with 60s countdown
- Handle 429 error from `signUp()` and `resend()` gracefully
- Google OAuth button must NOT trigger OTP step

- [ ] **Step 1: Replace `signUpSuccess` state with `step` state machine**

In `src/app/pages/SignUpPage.tsx`, replace lines 74 (`const [signUpSuccess, setSignUpSuccess] = useState(false);`) with:

```tsx
const [step, setStep] = useState<'form' | 'otp'>('form');
const [otp, setOtp] = useState("");
const [otpError, setOtpError] = useState<string | null>(null);
const [otpLoading, setOtpLoading] = useState(false);
const [resendCountdown, setResendCountdown] = useState(0);
```

- [ ] **Step 2: Update `handleSubmit` to set `step` instead of `signUpSuccess`**

Replace the `else { setSignUpSuccess(true); }` block (lines 123-125) and add 429 handling:

```tsx
const { data, error } = await supabase.auth.signUp({
  email,
  password,
  options: { data: { full_name: fullName } },
});
if (error) {
  if (error.status === 429) {
    setAuthError(isVi ? "Quá nhiều yêu cầu, vui lòng thử lại sau." : "Too many requests, please try again later.");
  } else {
    setAuthError(error.message);
  }
} else if (data.user && data.user.identities && data.user.identities.length === 0) {
  setAuthError(isVi ? "Email này đã được đăng ký. Vui lòng đăng nhập." : "This email is already registered. Please sign in.");
} else {
  setStep('otp');
  startResendCountdown();
}
```

- [ ] **Step 3: Add `startResendCountdown`, `handleVerifyOtp`, `handleResend` functions**

Add these three functions after `handleSubmit` (before the `if (signUpSuccess)` block):

```tsx
const startResendCountdown = () => {
  setResendCountdown(60);
  const iv = setInterval(() => {
    setResendCountdown((c) => {
      if (c <= 1) { clearInterval(iv); return 0; }
      return c - 1;
    });
  }, 1000);
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
    const { error } = await supabase.auth.verifyOtp({ email, token: otp, type: 'signup' });
    if (error) {
      setOtpError(isVi ? "Mã OTP không hợp lệ hoặc đã hết hạn." : "Invalid or expired OTP code.");
    }
    // On success Supabase auto-navigates via AuthContext session change → no explicit redirect needed
  } catch {
    setOtpError(isVi ? "Đã xảy ra lỗi, vui lòng thử lại." : "An error occurred, please try again.");
  } finally {
    setOtpLoading(false);
  }
};

const handleResendSignup = async () => {
  if (resendCountdown > 0) return;
  try {
    const { error } = await supabase.auth.resend({ type: 'signup', email });
    if (error && error.status === 429) {
      setOtpError(isVi ? "Quá nhiều yêu cầu, vui lòng thử lại sau." : "Too many requests, please try again later.");
      return;
    }
    startResendCountdown();
  } catch {
    // best-effort resend, ignore error
  }
};
```

- [ ] **Step 4: Replace the old `if (signUpSuccess)` block with `if (step === 'otp')` OTP UI**

Replace lines 133-154 (the old success block) with:

```tsx
if (step === 'otp') {
  return (
    <div className="min-h-screen flex bg-white dark:bg-gray-950 text-gray-900 dark:text-gray-100">
      <div className="flex-1 flex flex-col justify-center items-center px-6 py-12 lg:max-w-[52%]">
        <div className="w-full max-w-[420px]">
          <Link to="/" className="inline-flex items-center gap-2.5 group mb-10">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-200">
              <Captions className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-gray-900 dark:text-gray-100 tracking-tight">
              <span className="text-violet-600">Sub</span>AI
            </span>
          </Link>

          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}>
            <div className="w-12 h-12 rounded-2xl bg-violet-50 flex items-center justify-center mb-5">
              <Mail className="w-6 h-6 text-violet-600" />
            </div>
            <h1 className="text-gray-900 dark:text-gray-100 mb-1.5" style={{ fontSize: "1.625rem", fontWeight: 700, lineHeight: 1.25 }}>
              {isVi ? "Xác minh email" : "Verify your email"}
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
              onClick={handleResendSignup}
              disabled={resendCountdown > 0}
              className="w-full mt-3 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl border border-gray-200 text-gray-700 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              style={{ fontSize: "0.9375rem", fontWeight: 500 }}
            >
              <RefreshCw className="w-4 h-4" />
              {resendCountdown > 0
                ? (isVi ? `Gửi lại sau ${resendCountdown}s` : `Resend in ${resendCountdown}s`)
                : (isVi ? "Gửi lại mã" : "Resend code")}
            </button>

            <p className="mt-6 text-center text-gray-500" style={{ fontSize: "0.875rem" }}>
              <button onClick={() => setStep('form')} className="text-violet-600 hover:text-violet-700 font-semibold">
                {isVi ? "← Dùng email khác" : "← Use different email"}
              </button>
            </p>
          </motion.div>
        </div>
      </div>
      <AuthRightPanel />
    </div>
  );
}
```

- [ ] **Step 5: Add missing imports**

At the top of `src/app/pages/SignUpPage.tsx`, update the lucide-react import line to include `Mail` and `RefreshCw`:

```tsx
import { Captions, Eye, EyeOff, ArrowRight, CheckCircle2, Mail, RefreshCw } from "lucide-react";
```

- [ ] **Step 6: Verify Google OAuth path is untouched**

Confirm `handleGoogleSignIn` (lines 93-101) calls `signInWithGoogle()` directly and does NOT touch the `step` state. No change needed — just verify it looks like:

```tsx
const handleGoogleSignIn = async () => {
  setOauthLoading(true);
  setOauthError(null);
  const { error } = await signInWithGoogle();
  if (error) {
    setOauthError(error);
    setOauthLoading(false);
  }
  // no setStep() call here — correct
};
```

- [ ] **Step 7: Commit**

```bash
git add src/app/pages/SignUpPage.tsx
git commit -m "feat: add OTP verification step to registration flow"
```

---

## Task 2: ForgotPasswordPage — Replace magic link with OTP flow

**Files:**
- Modify: `src/app/pages/ForgotPasswordPage.tsx`

### What changes
- Change `Stage` type from `"form" | "sent"` to `"form" | "otp" | "new-password"`
- Remove `redirectTo` from `resetPasswordForEmail()` call
- Add OTP input step with `verifyOtp({ type: 'recovery' })`
- Add new-password step with `updateUser({ password })` — password + confirm fields
- On `new-password` step: hide nav/back links to prevent implicit-login escape
- Keep existing resend logic but update it (no `redirectTo`)

- [ ] **Step 1: Update `Stage` type and add new state variables**

Replace lines 9 (`type Stage = "form" | "sent";`) through 18 (end of state declarations) with:

```tsx
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
```

- [ ] **Step 2: Add `useNavigate` import**

Update line 2 of `ForgotPasswordPage.tsx`:

```tsx
import { Link, useNavigate } from "react-router";
```

- [ ] **Step 3: Update `handleSubmit` — remove `redirectTo`, transition to `'otp'`**

Replace the entire `handleSubmit` function (lines 26-41):

```tsx
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
    } else {
      // Always show success to prevent email enumeration
      setStage("otp");
      startCountdown();
    }
    return;
  }
  setStage("otp");
  startCountdown();
};
```

- [ ] **Step 4: Update `handleResend` — remove `redirectTo`**

Replace the `handleResend` function (lines 53-60):

```tsx
const handleResend = async () => {
  if (countdown > 0) return;
  setIsLoading(true);
  await supabase.auth.resetPasswordForEmail(email);
  setIsLoading(false);
  startCountdown();
};
```

- [ ] **Step 5: Add `handleVerifyOtp` and `handleUpdatePassword` functions**

Add these two functions after `handleResend`:

```tsx
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
      // Do NOT reset to 'form' — keep user on 'new-password'
    } else {
      navigate("/upload", { replace: true });
    }
  } catch {
    setPasswordError(isVi ? "Đã xảy ra lỗi, vui lòng thử lại." : "An error occurred, please try again.");
  } finally {
    setPasswordLoading(false);
  }
};
```

- [ ] **Step 6: Replace the `stage === "sent"` branch with `stage === "otp"` and `stage === "new-password"` branches**

The `AnimatePresence` block (lines 77-275) currently has two branches: `stage === "form"` and `stage === "sent"`. Replace the `stage === "sent"` branch entirely with two new branches:

```tsx
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
  /* stage === "new-password" — hide back links (implicit login active) */
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
```

- [ ] **Step 7: Add missing imports to ForgotPasswordPage**

Update the lucide-react import line to include `Eye`, `EyeOff`, `CheckCircle2`:

```tsx
import { Captions, ArrowLeft, Mail, CheckCircle2, ArrowRight, RefreshCw, Eye, EyeOff } from "lucide-react";
```

- [ ] **Step 8: Commit**

```bash
git add src/app/pages/ForgotPasswordPage.tsx
git commit -m "feat: add OTP + new-password steps to forgot password flow"
```

---

## Task 3: ResetPasswordPage — Redirect to forgot-password

**Files:**
- Modify: `src/app/pages/ResetPasswordPage.tsx`

### What changes
`/reset-password` was used by the old magic link flow (Supabase redirected here after user clicked email link). That flow is gone. Anyone landing here (old bookmarks, old emails) should be redirected to `/forgot-password`.

- [ ] **Step 1: Replace ResetPasswordPage with a redirect**

Replace the entire content of `src/app/pages/ResetPasswordPage.tsx` with:

```tsx
import { useEffect } from "react";
import { useNavigate } from "react-router";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/forgot-password", { replace: true });
  }, [navigate]);
  return null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/app/pages/ResetPasswordPage.tsx
git commit -m "refactor: redirect /reset-password to /forgot-password (OTP flow replaces magic link)"
```

---

## Self-Review

**Spec coverage check:**
- ✅ Registration: `signUp()` → OTP step → `verifyOtp({ type: 'signup' })` — Task 1
- ✅ Registration resend: `resend({ type: 'signup', email })` with 60s countdown — Task 1 Step 3
- ✅ Registration 429 handling — Task 1 Step 2
- ✅ Google OAuth bypass: untouched, verified in Task 1 Step 6
- ✅ Forgot password: `resetPasswordForEmail()` without `redirectTo` → OTP → `verifyOtp({ type: 'recovery' })` → `updateUser()` — Task 2
- ✅ Forgot password resend: calls `resetPasswordForEmail()` again (safer for recovery) — Task 2 Step 4
- ✅ Implicit login mitigation: back links hidden on `new-password` step — Task 2 Step 6
- ✅ Error on `updateUser()` stays on `new-password` — Task 2 Step 5
- ✅ Post-update redirect to `/upload` (not signOut) — Task 2 Step 5
- ✅ Supabase dashboard config documented as pre-requisite
- ✅ `/reset-password` repurposed — Task 3

**Type consistency:** `stage` typed as `"form" | "otp" | "new-password"` throughout Task 2. `step` typed as `"form" | "otp"` throughout Task 1. No cross-task naming conflicts.

**Placeholder scan:** No TBD, TODO, or vague steps found.
