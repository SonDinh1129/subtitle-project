import { useState } from 'react'
import { useNavigate } from 'react-router'
import { UserCircle, Loader2, CheckCircle2, AlertCircle } from 'lucide-react'
import { useAuth } from '../context/AuthContext'
import { useUiPreferences } from '../context/UiPreferencesContext'
import { updateProfile, changePassword, deleteAccount } from '../../lib/api'
import { supabase } from '../../lib/supabase'

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
  const [currentPassword, setCurrentPassword] = useState('')
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
    if (!currentPassword) {
      setPwFeedback({ type: 'error', message: isVi ? 'Vui lòng nhập mật khẩu hiện tại' : 'Please enter your current password' })
      return
    }
    if (newPassword !== confirmPassword) {
      setPwFeedback({ type: 'error', message: isVi ? 'Mật khẩu mới không khớp' : 'Passwords do not match' })
      return
    }
    if (newPassword.length < 8) {
      setPwFeedback({ type: 'error', message: isVi ? 'Mật khẩu tối thiểu 8 ký tự' : 'Password must be at least 8 characters' })
      return
    }
    setPwLoading(true)
    try {
      // Verify current password via Supabase before calling backend
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user?.email ?? '',
        password: currentPassword,
      })
      if (signInError) {
        setPwFeedback({ type: 'error', message: isVi ? 'Mật khẩu hiện tại không đúng' : 'Current password is incorrect' })
        return
      }
      const res = await changePassword(newPassword)
      if (res.ok) {
        setCurrentPassword('')
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
            <p className="text-xs text-gray-400 dark:text-gray-500">
              {isVi ? 'Tham gia' : 'Joined'}: {createdAt}
            </p>
            {infoFeedback && <Feedback state={infoFeedback} />}
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
                {isVi ? 'Mật khẩu hiện tại' : 'Current Password'}
              </label>
              <input
                type="password"
                value={currentPassword}
                onChange={e => setCurrentPassword(e.target.value)}
                placeholder={isVi ? 'Nhập mật khẩu hiện tại' : 'Enter current password'}
                className="w-full px-3 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-900 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
            </div>
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
                {isVi ? 'Xác nhận mật khẩu mới' : 'Confirm New Password'}
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
                disabled={pwLoading || !currentPassword || !newPassword || !confirmPassword}
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
