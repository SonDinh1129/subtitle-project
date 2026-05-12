# Profile Page Design Spec
**Date:** 2026-05-12  
**Status:** Approved

## Overview

Trang `/profile` cho phép user xem và chỉnh sửa thông tin tài khoản. Đây là protected route nằm trong Root layout (có Header + Footer). Truy cập qua link "Thông tin tài khoản" trong dropdown menu của Header.

---

## 1. Routing & Files

### New files
- `src/app/pages/ProfilePage.tsx` — page component
- `backend/routes/profile.py` (hoặc tương đương) — 3 API endpoints mới

### Modified files
- `src/app/routes.ts` — thêm protected route `/profile`
- `src/app/components/Header.tsx` — thêm link "Thông tin tài khoản" trong user dropdown
- `src/app/context/AuthContext.tsx` — thêm `updateProfile()` nếu cần (hiện đã có `refreshProfile()`)

### Backend endpoints
| Method | Path | Description |
|--------|------|-------------|
| `PATCH` | `/auth/profile` | Cập nhật `full_name` |
| `POST` | `/auth/change-password` | Đổi mật khẩu qua Supabase Admin API |
| `DELETE` | `/auth/account` | Xóa tài khoản + dữ liệu liên quan |

Tất cả endpoints yêu cầu JWT Bearer token trong header `Authorization`. Backend extract `user_id` từ token qua Supabase verify.

---

## 2. UI Layout

Single page, centered container `max-w-2xl`, padding `py-10 px-4`. 3 card sections cuộn dọc theo thứ tự:

```
┌─────────────────────────────────────┐
│  👤 Thông tin tài khoản             │  ← page title (h1)
├─────────────────────────────────────┤
│  CARD 1: Thông tin cơ bản           │
│  ┌─────────────────────────────┐   │
│  │ Email (read-only, disabled) │   │
│  │ Họ tên [__________________] │   │
│  │ Tham gia: 12/01/2024        │   │
│  │              [Lưu thay đổi] │   │
│  └─────────────────────────────┘   │
│                                     │
│  CARD 2: Đổi mật khẩu              │
│  ┌─────────────────────────────┐   │
│  │ Mật khẩu hiện tại [_______] │   │
│  │ Mật khẩu mới [____________] │   │
│  │ Xác nhận    [____________]  │   │
│  │              [Đổi mật khẩu] │   │
│  └─────────────────────────────┘   │
│                                     │
│  CARD 3: Vùng nguy hiểm            │
│  ┌─────────────────────────────┐   │
│  │ ⚠️ border đỏ, title đỏ      │   │
│  │ Nhập email để xác nhận      │   │
│  │ [____________________]      │   │
│  │              [Xóa tài khoản]│   │
│  └─────────────────────────────┘   │
└─────────────────────────────────────┘
```

### Card styling
- **Card 1 & 2:** `rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6`
- **Card 3 (Danger zone):** `rounded-2xl border border-red-200 dark:border-red-900 bg-white dark:bg-gray-900 p-6`

### Button styling
- **Card 1 & 2 submit:** gradient violet-indigo (primary pattern hiện tại)
- **Card 3 delete:** `bg-red-600 hover:bg-red-700 text-white`
- Tất cả buttons có `disabled` state khi đang loading (spinner icon)

### Feedback
- Inline success/error message ngay dưới mỗi form (không dùng global toast)
- Success: text xanh lá + icon checkmark
- Error: text đỏ + icon alert

---

## 3. Data Flow

### Card 1 — Thông tin cơ bản
- Mount: load `profile.full_name` từ `AuthContext` vào input
- Submit: `PATCH /auth/profile` với body `{ full_name: string }`
- Success: gọi `refreshProfile()` để AuthContext sync lại

### Card 2 — Đổi mật khẩu
- Client validation trước khi gọi API:
  - 3 field: mật khẩu hiện tại, mật khẩu mới, xác nhận mật khẩu mới
  - Mật khẩu mới và xác nhận phải khớp nhau
  - Mật khẩu mới tối thiểu 8 ký tự
- Frontend verify mật khẩu cũ trước: gọi `supabase.auth.signInWithPassword({ email, password: currentPassword })` — nếu sai trả lỗi ngay, không gọi API backend
- Nếu đúng: Submit `POST /auth/change-password` với body `{ new_password: string }`
- Backend: gọi Supabase Admin API `auth.admin.updateUserById(userId, { password })`
- Success: clear cả 3 input field

### Card 3 — Xóa tài khoản
- Button `Xóa tài khoản` chỉ enable khi giá trị input email khớp với `user.email`
- Submit: `DELETE /auth/account`
- Backend: xóa user khỏi Supabase Auth (`auth.admin.deleteUser(userId)`) + xóa data liên quan trong DB
- Success: gọi `signOut()` rồi `navigate('/')`

---

## 4. Header Integration

Trong dropdown menu user của `Header.tsx`, thêm link ngay trên "Đăng xuất":

```
┌──────────────────────┐
│ 👤 Thông tin tài khoản │  ← navigate('/profile')
│ ⬆️ Nâng cấp Premium  │  (nếu chưa premium)
│ 🚪 Đăng xuất         │
└──────────────────────┘
```

Icon: `UserCircle` từ lucide-react (đồng nhất với pattern icon hiện tại).

---

## 5. Bilingual Support

Thêm strings EN/VN vào language config hiện tại cho tất cả labels, placeholders, messages của trang profile. Sử dụng `useUiPreferences()` như các page khác.

---

## 6. Out of Scope

- Avatar/ảnh đại diện
- Thông báo/notification settings
- OAuth provider linking
- Export data
