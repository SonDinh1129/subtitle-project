# Email OTP Authentication Design

**Date:** 2026-05-10  
**Scope:** Registration + Forgot Password flows  
**Approach:** Supabase built-in OTP (no custom backend, no extra DB tables)

---

## Overview

Replace Supabase's default magic link emails with 6-digit OTP codes for two flows:
1. **Registration** — verify email after signup with OTP instead of confirmation link
2. **Forgot Password** — reset password via OTP instead of reset link

No backend (Flask) changes required. All OTP logic is handled by Supabase Auth on the frontend.

---

## Supabase Dashboard Configuration (Required Before Code)

Both flows require updating email templates in:  
**Supabase Dashboard → Authentication → Email Templates**

| Template | Change |
|----------|--------|
| Confirm signup | Remove `{{ .ConfirmationURL }}`, add `{{ .Token }}` (6-digit OTP) |
| Reset password | Remove `{{ .ConfirmationURL }}`, add `{{ .Token }}` (6-digit OTP) |

Without this, Supabase will still send magic links instead of OTP codes.

---

## 1. Registration Flow

### State Machine
```
'form' → 'otp'
```

### Steps

**Action 1 — Submit Form**
- User enters email + password
- Call `supabase.auth.signUp({ email, password })`
- On success → transition to `'otp'` state
- On error 429 → show "Quá nhiều yêu cầu, vui lòng thử lại sau"
- On other error → show error message, stay on `'form'`

**Action 2 — Verify OTP**
- User enters 6-digit OTP received via email
- Call `supabase.auth.verifyOtp({ email, token, type: 'signup' })`
- On success → Supabase auto-creates session → redirect to `/upload`
- On error → show "Mã OTP không hợp lệ hoặc đã hết hạn", stay on `'otp'`

**Action 3 — Resend OTP**
- Button "Gửi lại mã" with 60s countdown timer
- On click → call `supabase.auth.resend({ type: 'signup', email })`
- Handle 429 gracefully

### Edge Cases
- **Google OAuth path:** `signInWithOAuth({ provider: 'google' })` bypasses OTP entirely — Google already verifies email. Must not set state to `'otp'` on Google click.
- **OTP expiry:** Supabase default TTL is 24h (configurable in dashboard). Display expiry note to user.

### Files to Change
- `src/app/pages/SignUpPage.tsx` — add step state, OTP input UI, resend logic

---

## 2. Forgot Password Flow

### State Machine
```
'form' → 'otp' → 'new-password'
```

### Steps

**Action 1 — Request OTP**
- User enters email on `/forgot-password`
- Call `supabase.auth.resetPasswordForEmail(email)`  
  Note: do NOT pass `redirectTo` — this forces OTP mode when template uses `{{ .Token }}`
- On success → transition to `'otp'` state
- On error 429 → show rate limit message
- Always show success-like message to prevent email enumeration (don't reveal if email exists)

**Action 2 — Verify OTP**
- User enters 6-digit OTP
- Call `supabase.auth.verifyOtp({ email, token, type: 'recovery' })`
- On success → Supabase establishes session immediately → transition to `'new-password'`
- On error → show "Mã OTP không hợp lệ hoặc đã hết hạn", stay on `'otp'`

**Action 3 — Set New Password**
- User enters new password (+ confirm field)
- Call `supabase.auth.updateUser({ password: newPassword })`
- On success → redirect to `/upload` (user is already logged in via recovery session)
- On error → show error inline, **do NOT reset state to `'form'`** — keep user on `'new-password'`

**Action 4 — Resend OTP**
- Button "Gửi lại mã" with 60s countdown, only visible on `'otp'` step
- On click → call `supabase.auth.resetPasswordForEmail(email)` again (safer than `resend()` for recovery flow)

### Edge Cases

**Implicit Login Gotcha:** When `verifyOtp({ type: 'recovery' })` succeeds, Supabase immediately creates a session — the user is logged in even before setting a new password. If user navigates away at `'new-password'` step, they remain logged in with the old password.  
→ Mitigation: Block navigation (hide header/nav) on `'new-password'` step, or show warning if user tries to leave.

**Post-Update Redirect:** After `updateUser()` success, redirect to `/upload` directly. Do NOT call `signOut()` — the recovery session is valid proof of identity (OTP was already verified), and forcing re-login adds unnecessary friction. This matches the pattern used by GitHub and Google.

**Password Validation:** Validate password on frontend before calling `updateUser()`:
- Minimum 8 characters
- Confirm password fields must match

### Files to Change
- `src/app/pages/ForgotPasswordPage.tsx` — add step state, OTP input, new password form
- `src/app/pages/ResetPasswordPage.tsx` — can be removed or kept as redirect to `/forgot-password` (magic link flow no longer used)

---

## Architecture Notes

- **No backend changes** — Flask only validates JWT after login; OTP flow is entirely frontend + Supabase
- **No new DB tables** — Supabase manages OTP storage internally
- **Rate limiting** — Supabase free tier: ~3-4 emails/hour. Handle 429 errors gracefully in UI
- **Email templates** — Customizable in Supabase dashboard (logo, branding, Vietnamese text)
- **OTP TTL** — Configurable in Supabase dashboard (default 24h, recommend 10-15 min for security)
