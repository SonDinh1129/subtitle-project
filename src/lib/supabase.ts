import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

/**
 * Google OAuth — Authorization Code flow with PKCE.
 * Params mirror the spec: scope=openid email profile, access_type=offline, response_type=code.
 * On success the browser is redirected; error is only returned on a local failure.
 */
export async function signInWithGoogle(): Promise<{ error: string | null }> {
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      scopes: "openid email profile",
      queryParams: {
        access_type: "offline",
        response_type: "code",
      },
    },
  });
  return { error: error?.message ?? null };
}
