import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { Captions } from "lucide-react";
import { supabase } from "../../lib/supabase";

export function AuthCallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Catch hash-based implicit flow: Supabase fires PASSWORD_RECOVERY when it detects
    // #access_token=...&type=recovery in the URL fragment (legacy email template).
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        navigate("/reset-password", { replace: true });
      }
    });

    const handle = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      const tokenHash = params.get("token_hash");
      const type = params.get("type") as "signup" | "recovery" | "email_change" | null;
      const errorParam = params.get("error");
      const errorDesc = params.get("error_description");

      if (errorParam === "access_denied") {
        navigate("/signin", { replace: true });
        return;
      }

      if (errorParam || errorDesc) {
        setError(errorDesc ?? errorParam ?? "Xác thực thất bại.");
        return;
      }

      // PKCE code flow — used by both OAuth and recovery email (newer Supabase)
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError) {
          setError(exchangeError.message);
          return;
        }
        navigate(type === "recovery" ? "/reset-password" : "/upload", { replace: true });
        return;
      }

      // Email OTP / token_hash flow
      if (tokenHash && type) {
        const { error: verifyError } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
        if (verifyError) {
          setError(verifyError.message);
          return;
        }
        navigate(type === "recovery" ? "/reset-password" : "/upload", { replace: true });
        return;
      }

      // Hash-based implicit flow handled by onAuthStateChange above.
      // Fallback: check if session already established.
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        navigate("/upload", { replace: true });
      } else {
        setError("Link không hợp lệ hoặc đã hết hạn.");
      }
    };

    handle();
    return () => subscription.unsubscribe();
  }, [navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-gray-950 px-6">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-200 mb-6">
          <Captions className="w-4.5 h-4.5 text-white" />
        </div>
        <div className="max-w-sm w-full text-center">
          <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">
            {error}
          </div>
          <button
            onClick={() => navigate("/signin", { replace: true })}
            className="text-violet-600 hover:text-violet-700 transition-colors text-sm font-semibold"
          >
            Quay lại đăng nhập
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-white dark:bg-gray-950 gap-4">
      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-200">
        <Captions className="w-4.5 h-4.5 text-white" />
      </div>
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <svg className="w-4 h-4 animate-spin text-violet-600" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Đang xác thực...
      </div>
    </div>
  );
}
