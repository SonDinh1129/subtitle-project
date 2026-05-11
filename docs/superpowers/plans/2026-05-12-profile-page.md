# Profile Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tạo trang `/profile` cho phép user xem và chỉnh sửa tên, đổi mật khẩu, và xóa tài khoản.

**Architecture:** Single page `/profile` (protected route, trong Root layout) với 3 card sections độc lập. Backend thêm 3 Flask endpoints vào `auth_controller.py`. Frontend gọi API qua pattern `authFetch` hiện có trong `src/lib/api.ts`.

**Tech Stack:** React + TypeScript, React Router v6, Supabase Auth, Flask, TailwindCSS, lucide-react icons, Framer Motion (optional cho feedback states).

---

## File Map

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `src/app/pages/ProfilePage.tsx` | Trang profile với 3 card sections |
| Modify | `src/app/routes.ts` | Thêm route `/profile` vào protected routes |
| Modify | `src/app/components/Header.tsx` | Thêm link "Thông tin tài khoản" vào user dropdown |
| Modify | `src/lib/api.ts` | Thêm 3 hàm API: `updateProfile`, `changePassword`, `deleteAccount` |
| Modify | `controllers/auth_controller.py` | Thêm 3 endpoints: PATCH /profile, POST /change-password, DELETE /account |

---

## Task 1: Backend — PATCH /auth/profile

**Files:**
- Modify: `controllers/auth_controller.py`

- [ ] **Step 1: Thêm endpoint vào auth_controller.py**

Mở `controllers/auth_controller.py` và thêm import + endpoint sau `get_me()`:

```python
from flask import Blueprint, g, jsonify, request
from middleware.auth import require_auth, get_profile, is_premium
from extensions import limiter

# ... (existing code) ...

@auth_bp.patch('/profile')
@require_auth
@limiter.limit("30/minute")
def update_profile():
    """
    PATCH /api/auth/profile
    Body: { "full_name": string }
    Returns: updated profile
    """
    data = request.get_json(silent=True) or {}
    full_name = data.get('full_name', '').strip()

    if not isinstance(full_name, str):
        return jsonify({'error': 'full_name must be a string'}), 400

    try:
        from middleware.auth import _get_supabase_service
        supabase = _get_supabase_service()
        result = supabase.table('profiles').update({
            'full_name': full_name or None,
        }).eq('id', g.user_id).execute()

        updated = result.data[0] if result.data else None
        if not updated:
            return jsonify({'error': 'Profile not found'}), 404

        return jsonify({
            **updated,
            'is_premium': is_premium(updated),
        }), 200
    except Exception as e:
        return jsonify({'error': 'Failed to update profile'}), 500
```

- [ ] **Step 2: Test thủ công với curl**

```bash
# Lấy token từ Supabase dashboard hoặc browser devtools
curl -X PATCH http://localhost:5000/api/auth/profile \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"full_name": "Test User"}'
```

Expected response:
```json
{"id": "...", "email": "...", "full_name": "Test User", "is_premium": false, ...}
```

- [ ] **Step 3: Commit**

```bash
git add controllers/auth_controller.py
git commit -m "feat: add PATCH /auth/profile endpoint"
```

---

## Task 2: Backend — POST /auth/change-password

**Files:**
- Modify: `controllers/auth_controller.py`

- [ ] **Step 1: Thêm endpoint đổi mật khẩu**

Thêm sau `update_profile()` trong `controllers/auth_controller.py`:

```python
@auth_bp.post('/change-password')
@require_auth
@limiter.limit("10/minute")
def change_password():
    """
    POST /api/auth/change-password
    Body: { "new_password": string }
    Uses Supabase Admin API to update password without requiring old password.
    """
    data = request.get_json(silent=True) or {}
    new_password = data.get('new_password', '')

    if not new_password or len(new_password) < 8:
        return jsonify({'error': 'Password must be at least 8 characters'}), 400

    try:
        from middleware.auth import _get_supabase_service
        supabase = _get_supabase_service()
        supabase.auth.admin.update_user_by_id(
            g.user_id,
            {'password': new_password}
        )
        return jsonify({'message': 'Password updated successfully'}), 200
    except Exception as e:
        return jsonify({'error': 'Failed to update password'}), 500
```

- [ ] **Step 2: Test thủ công**

```bash
curl -X POST http://localhost:5000/api/auth/change-password \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"new_password": "newpassword123"}'
```

Expected: `{"message": "Password updated successfully"}`

- [ ] **Step 3: Commit**

```bash
git add controllers/auth_controller.py
git commit -m "feat: add POST /auth/change-password endpoint"
```

---

## Task 3: Backend — DELETE /auth/account

**Files:**
- Modify: `controllers/auth_controller.py`

- [ ] **Step 1: Thêm endpoint xóa tài khoản**

Thêm sau `change_password()` trong `controllers/auth_controller.py`:

```python
@auth_bp.delete('/account')
@require_auth
@limiter.limit("5/hour")
def delete_account():
    """
    DELETE /api/auth/account
    Deletes user from Supabase Auth and profiles table.
    Frontend must call signOut() after this succeeds.
    """
    try:
        from middleware.auth import _get_supabase_service
        supabase = _get_supabase_service()

        # Delete profile data first (foreign key constraint)
        supabase.table('profiles').delete().eq('id', g.user_id).execute()

        # Delete from Supabase Auth (hard delete)
        supabase.auth.admin.delete_user(g.user_id)

        return jsonify({'message': 'Account deleted successfully'}), 200
    except Exception as e:
        return jsonify({'error': 'Failed to delete account'}), 500
```

- [ ] **Step 2: Test thủ công**

```bash
curl -X DELETE http://localhost:5000/api/auth/account \
  -H "Authorization: Bearer YOUR_TOKEN"
```

Expected: `{"message": "Account deleted successfully"}`

- [ ] **Step 3: Commit**

```bash
git add controllers/auth_controller.py
git commit -m "feat: add DELETE /auth/account endpoint"
```

---

## Task 4: Frontend API functions

**Files:**
- Modify: `src/lib/api.ts`

- [ ] **Step 1: Thêm 3 hàm API vào src/lib/api.ts**

Mở `src/lib/api.ts` và thêm các hàm sau vào cuối file (trước dấu `}`  nếu có, hoặc append):

```typescript
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
```

> **Note:** `authFetch` đã có sẵn trong `api.ts` — nó tự đính kèm `Authorization: Bearer <token>` từ Supabase session hiện tại.

- [ ] **Step 2: Verify TypeScript compile**

```bash
cd c:\Users\sondb\Desktop\subtitle-project
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/lib/api.ts
git commit -m "feat: add updateProfile, changePassword, deleteAccount API functions"
```

---

## Task 5: ProfilePage component

**Files:**
- Create: `src/app/pages/ProfilePage.tsx`

- [ ] **Step 1: Tạo ProfilePage.tsx**

```tsx
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { UserCircle, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useUiPreferences } from '../context/UiPreferencesContext'
import { updateProfile, changePassword, deleteAccount } from '../../lib/api'

type FeedbackState = { type: 'success' | 'error'; message: string } | null

export function ProfilePage() {
  const { user, profile, signOut, refreshProfile } = useAuth()
  const { language } = useUiPreferences()
  const isVi = language === 'vi'
  const navigate = useNavigate()

  // Card 1 — Basic info
  const [fullName, setFullName] = useState(profile?.full_name ?? '')
  const [infoLoading, setInfoLoading] = useState(false)
  const [infoFeedback, setInfoFeedback] = useState<FeedbackState>(null)

  // Card 2 — Change password
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwLoading, setPwLoading] = useState(false)
  const [pwFeedback, setPwFeedback] = useState<FeedbackState>(null)

  // Card 3 — Delete account
  const [deleteConfirmEmail, setDeleteConfirmEmail] = useState('')
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [deleteFeedback, setDeleteFeedback] = useState<FeedbackState>(null)

  const createdAt = profile?.created_at
    ? new Date(profile.created_at).toLocaleDateString(isVi ? 'vi-VN' : 'en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
      })
    : '—'

  async function handleUpdateInfo(e: React.FormEvent) {
    e.preventDefault()
    setInfoLoading(true)
    setInfoFeedback(null)
    try {
      const res = await updateProfile(fullName)
      if (res.ok) {
        await refreshProfile()
        setInfoFeedback({ type: 'success', message: isVi ? 'Đã lưu thay đổi' : 'Changes saved' })
      } else {
        const data = await res.json()
        setInfoFeedback({ type: 'error', message: data.error ?? (isVi ? 'Có lỗi xảy ra' : 'Something went wrong') })
      }
    } catch {
      setInfoFeedback({ type: 'error', message: isVi ? 'Có lỗi xảy ra' : 'Something went wrong' })
    } finally {
      setInfoLoading(false)
    }
  }

  async function handleChangePassword(e: React.FormEvent) {
    e.preventDefault()
    setPwFeedback(null)
    if (newPassword !== confirmPassword) {
      setPwFeedback({ type: 'error', message: isVi ? 'Mật khẩu không khớp' : 'Passwords do not match' })
      return
    }
    if (newPassword.length < 8) {
      setPwFeedback({ type: 'error', message: isVi ? 'Mật khẩu tối thiểu 8 ký tự' : 'Password must be at least 8 characters' })
      return
    }
    setPwLoading(true)
    try {
      const res = await changePassword(newPassword)
      if (res.ok) {
        setNewPassword('')
        setConfirmPassword('')
        setPwFeedback({ type: 'success', message: isVi ? 'Đã đổi mật khẩu thành công' : 'Password changed successfully' })
      } else {
        const data = await res.json()
        setPwFeedback({ type: 'error', message: data.error ?? (isVi ? 'Có lỗi xảy ra' : 'Something went wrong') })
      }
    } catch {
      setPwFeedback({ type: 'error', message: isVi ? 'Có lỗi xảy ra' : 'Something went wrong' })
    } finally {
      setPwLoading(false)
    }
  }

  async function handleDeleteAccount(e: React.FormEvent) {
    e.preventDefault()
    setDeleteFeedback(null)
    setDeleteLoading(true)
    try {
      const res = await deleteAccount()
      if (res.ok) {
        await signOut()
        navigate('/')
      } else {
        const data = await res.json()
        setDeleteFeedback({ type: 'error', message: data.error ?? (isVi ? 'Có lỗi xảy ra' : 'Something went wrong') })
      }
    } catch {
      setDeleteFeedback({ type: 'error', message: isVi ? 'Có lỗi xảy ra' : 'Something went wrong' })
    } finally {
      setDeleteLoading(false)
    }
  }

  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* Page title */}
        <div className="flex items-center gap-3">
          <UserCircle className="w-7 h-7 text-violet-600" />
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
            {isVi ? 'Thông tin tài khoản' : 'Account Settings'}
          </h1>
        </div>

        {/* Card 1 — Basic info */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {isVi ? 'Thông tin cơ bản' : 'Basic Information'}
          </h2>
          <form onSubmit={handleUpdateInfo} className="space-y-4">
            {/* Email - read only */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-600 dark:text-gray-400">
                Email
              </label>
              <input
                type="email"
                value={user?.email ?? ''}
                disabled
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-500 dark:text-gray-400 text-sm cursor-not-allowed"
              />
            </div>
            {/* Full name */}
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isVi ? 'Họ tên' : 'Full Name'}
              </label>
              <input
                type="text"
                value={fullName}
                onChange={e => setFullName(e.target.value)}
                placeholder={isVi ? 'Nhập họ tên của bạn' : 'Enter your full name'}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            {/* Joined date */}
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {isVi ? 'Tham gia' : 'Joined'}: {createdAt}
            </p>
            {/* Feedback */}
            {infoFeedback && <Feedback state={infoFeedback} />}
            {/* Submit */}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={infoLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium disabled:opacity-70 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {infoLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {isVi ? 'Lưu thay đổi' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>

        {/* Card 2 — Change password */}
        <div className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6 space-y-4">
          <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">
            {isVi ? 'Đổi mật khẩu' : 'Change Password'}
          </h2>
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isVi ? 'Mật khẩu mới' : 'New Password'}
              </label>
              <input
                type="password"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder={isVi ? 'Tối thiểu 8 ký tự' : 'At least 8 characters'}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isVi ? 'Xác nhận mật khẩu' : 'Confirm Password'}
              </label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder={isVi ? 'Nhập lại mật khẩu mới' : 'Re-enter new password'}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
            {pwFeedback && <Feedback state={pwFeedback} />}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={pwLoading || !newPassword || !confirmPassword}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 text-white text-sm font-medium disabled:opacity-70 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
              >
                {pwLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {isVi ? 'Đổi mật khẩu' : 'Change Password'}
              </button>
            </div>
          </form>
        </div>

        {/* Card 3 — Danger zone */}
        <div className="rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-gray-900 p-6 space-y-4">
          <h2 className="text-base font-semibold text-red-600 dark:text-red-400">
            {isVi ? 'Vùng nguy hiểm' : 'Danger Zone'}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {isVi
              ? 'Xóa tài khoản sẽ xóa vĩnh viễn toàn bộ dữ liệu của bạn và không thể khôi phục.'
              : 'Deleting your account will permanently remove all your data and cannot be undone.'}
          </p>
          <form onSubmit={handleDeleteAccount} className="space-y-4">
            <div className="space-y-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {isVi
                  ? `Nhập email "${user?.email}" để xác nhận`
                  : `Type "${user?.email}" to confirm`}
              </label>
              <input
                type="email"
                value={deleteConfirmEmail}
                onChange={e => setDeleteConfirmEmail(e.target.value)}
                placeholder={user?.email ?? ''}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>
            {deleteFeedback && <Feedback state={deleteFeedback} />}
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={deleteLoading || deleteConfirmEmail !== user?.email}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium disabled:opacity-70 disabled:cursor-not-allowed transition-colors"
              >
                {deleteLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                {isVi ? 'Xóa tài khoản' : 'Delete Account'}
              </button>
            </div>
          </form>
        </div>

      </div>
    </div>
  )
}

function Feedback({ state }: { state: { type: 'success' | 'error'; message: string } }) {
  if (state.type === 'success') {
    return (
      <div className="flex items-center gap-2 text-sm text-green-600 dark:text-green-400">
        <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
        {state.message}
      </div>
    )
  }
  return (
    <div className="flex items-center gap-2 text-sm text-red-600 dark:text-red-400">
      <AlertCircle className="w-4 h-4 flex-shrink-0" />
      {state.message}
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd c:\Users\sondb\Desktop\subtitle-project
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/app/pages/ProfilePage.tsx
git commit -m "feat: add ProfilePage component"
```

---

## Task 6: Thêm route /profile

**Files:**
- Modify: `src/app/routes.ts`

- [ ] **Step 1: Cập nhật routes.ts**

Mở `src/app/routes.ts`. Thêm import và route:

```typescript
import { createBrowserRouter } from "react-router";
import { Root } from "./Root";
import { LandingPage } from "./pages/LandingPage";
import { UploadPage } from "./pages/UploadPage";
import { EditorPage } from "./pages/EditorPage";
import { NotFound } from "./pages/NotFound";
import { SignInPage } from "./pages/SignInPage";
import { SignUpPage } from "./pages/SignUpPage";
import { ForgotPasswordPage } from "./pages/ForgotPasswordPage";
import { AuthCallbackPage } from "./pages/AuthCallbackPage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { UpgradePage } from "./pages/UpgradePage";
import { UpgradeSuccessPage } from "./pages/UpgradeSuccessPage";
import { ProfilePage } from "./pages/ProfilePage";
import { ProtectedRoute } from "./components/ProtectedRoute";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Root,
    children: [
      { index: true, Component: LandingPage },
      { path: "upload", Component: UploadPage },
      // Protected routes — require login
      {
        Component: ProtectedRoute,
        children: [
          { path: "editor", Component: EditorPage },
          { path: "upgrade", Component: UpgradePage },
          { path: "upgrade/success", Component: UpgradeSuccessPage },
          { path: "profile", Component: ProfilePage },
        ],
      },
      { path: "*", Component: NotFound },
    ],
  },
  // Auth routes — standalone (no Header/Footer)
  { path: "/signin", Component: SignInPage },
  { path: "/signup", Component: SignUpPage },
  { path: "/forgot-password", Component: ForgotPasswordPage },
  { path: "/auth/callback", Component: AuthCallbackPage },
  { path: "/reset-password", Component: ResetPasswordPage },
]);
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/app/routes.ts
git commit -m "feat: add /profile route"
```

---

## Task 7: Thêm link vào Header dropdown

**Files:**
- Modify: `src/app/components/Header.tsx`

- [ ] **Step 1: Thêm import UserCircle và Link vào profile**

Mở `src/app/components/Header.tsx`. Tìm dòng import `lucide-react` và đảm bảo `UserCircle` có trong danh sách:

```typescript
import { Crown, LogOut, Menu, X, ChevronDown, Sun, Moon, UserCircle } from 'lucide-react'
```

> Nếu `UserCircle` đã có thì không cần thêm.

- [ ] **Step 2: Thêm link "Thông tin tài khoản" vào desktop dropdown**

Trong Header.tsx, tìm đoạn desktop user dropdown (khoảng dòng 120-160, nơi hiển thị email + upgrade + signout). Thêm link profile ngay trước link Upgrade:

Tìm đoạn code này (desktop dropdown):
```tsx
{!isPremium && (
  <Link
    to="/upgrade"
    className="..."
  >
```

Thêm link profile TRƯỚC đoạn `{!isPremium && ...}`:
```tsx
<Link
  to="/profile"
  className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
>
  <UserCircle className="w-4 h-4" />
  {isVi ? 'Thông tin tài khoản' : 'Account Settings'}
</Link>
```

- [ ] **Step 3: Thêm link vào mobile menu**

Tìm đoạn mobile menu user section (khoảng dòng 190-213, nơi có `{user ? (...) : (...)}`). Thêm link profile ngay sau email display và trước `{!isPremium && ...}`:

Sau:
```tsx
<div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
  {isPremium && <Crown className="w-4 h-4 text-amber-500" />}
  <span className="truncate">{user.email}</span>
</div>
```

Thêm:
```tsx
<Link
  to="/profile"
  onClick={() => setMobileOpen(false)}
  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900 rounded-lg"
>
  <UserCircle className="w-4 h-4" />
  {isVi ? 'Thông tin tài khoản' : 'Account Settings'}
</Link>
```

- [ ] **Step 4: TypeScript check và visual test**

```bash
npx tsc --noEmit
```

Mở browser tại `http://localhost:5173`, đăng nhập, click vào user menu — phải thấy link "Thông tin tài khoản" xuất hiện.

- [ ] **Step 5: Commit**

```bash
git add src/app/components/Header.tsx
git commit -m "feat: add profile link to header user menu"
```

---

## Task 8: Smoke test toàn bộ flow

- [ ] **Step 1: Chạy dev server**

```bash
cd c:\Users\sondb\Desktop\subtitle-project
npm run dev
```

- [ ] **Step 2: Test flow cơ bản**

1. Đăng nhập → click user menu → click "Thông tin tài khoản" → phải navigate tới `/profile`
2. Trang profile hiển thị đúng: email (disabled), full_name field, ngày tham gia
3. Sửa họ tên → Save → hiện "Đã lưu thay đổi" (xanh)
4. Nhập 2 password không khớp → submit → hiện error "Mật khẩu không khớp"
5. Nhập password < 8 ký tự → submit → hiện error
6. Danger zone: button "Xóa tài khoản" disabled khi email chưa khớp, enable khi nhập đúng email

- [ ] **Step 3: Test dark mode**

Toggle dark mode trong Header → trang profile phải render đúng màu.

- [ ] **Step 4: Test responsive (mobile)**

Resize browser về mobile width → kiểm tra layout không bị vỡ.

- [ ] **Step 5: Final commit nếu cần fix**

```bash
git add -p
git commit -m "fix: profile page polish"
```
