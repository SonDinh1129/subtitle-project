import { Navigate, Outlet, useLocation } from 'react-router'
import { useAuth } from '../context/AuthContext'

export function ProtectedRoute() {
  const { user, isLoading } = useAuth()
  const location = useLocation()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <svg className="w-8 h-8 animate-spin text-violet-600" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm text-gray-500 dark:text-gray-400">Loading...</span>
        </div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/signin" state={{ from: location }} replace />
  }

  return <Outlet />
}
