import { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'
import type { User, Session } from '@supabase/supabase-js'
import { supabase } from '../../lib/supabase'
import { authFetchWithToken } from '../../lib/api'

export interface UserProfile {
  id: string
  email: string
  full_name: string | null
  premium_until: string | null
  videos_used_this_month: number
  usage_reset_at: string
  created_at: string
  is_premium: boolean
}

interface AuthContextValue {
  user: User | null
  session: Session | null
  profile: UserProfile | null
  isLoading: boolean
  isPremium: boolean
  signOut: () => Promise<void>
  refreshProfile: () => Promise<boolean>
}

const AuthContext = createContext<AuthContextValue | null>(null)

async function fetchProfile(accessToken: string): Promise<UserProfile | null> {
  try {
    const res = await authFetchWithToken('/auth/me', accessToken)
    if (!res.ok) return null
    return res.json()
  } catch {
    return null
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [session, setSession] = useState<Session | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  const refreshProfile = useCallback(async (): Promise<boolean> => {
    const { data: { session: currentSession } } = await supabase.auth.getSession()
    if (!currentSession) {
      setProfile(null)
      return false
    }
    const p = await fetchProfile(currentSession.access_token)
    setProfile(p)
    return p?.is_premium ?? false
  }, [])

  useEffect(() => {
    // onAuthStateChange fires INITIAL_SESSION immediately on subscribe,
    // so no need for a separate getSession() call — that would double-fetch /auth/me.
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, s) => {
      setSession(s)
      setUser(s?.user ?? null)
      if (s) {
        const p = await fetchProfile(s.access_token)
        setProfile(p)
      } else {
        setProfile(null)
      }
      setIsLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const signOut = async () => {
    await supabase.auth.signOut()
    setUser(null)
    setSession(null)
    setProfile(null)
  }

  // isPremium comes from backend-computed is_premium field — do NOT recalculate from premium_until
  const isPremium = profile?.is_premium ?? false

  return (
    <AuthContext.Provider value={{ user, session, profile, isLoading, isPremium, signOut, refreshProfile }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
