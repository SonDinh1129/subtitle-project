import { useEffect, useState, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { motion } from "motion/react";
import { Crown, CheckCircle2, Loader2 } from "lucide-react";
import { useUiPreferences } from "../context/UiPreferencesContext";
import { useAuth } from "../context/AuthContext";

export function UpgradeSuccessPage() {
  const { language } = useUiPreferences();
  const { refreshProfile, isPremium } = useAuth();
  const isVi = language === "vi";
  const navigate = useNavigate();
  const [status, setStatus] = useState<"polling" | "success" | "timeout">("polling");
  const attemptsRef = useRef(0);
  const MAX_ATTEMPTS = 10;

  useEffect(() => {
    // Poll /api/auth/me until is_premium = true (max 10 × 2s = 20s)
    const poll = async () => {
      if (attemptsRef.current >= MAX_ATTEMPTS) {
        setStatus("timeout");
        return;
      }
      attemptsRef.current += 1;
      await refreshProfile();

      if (isPremium) {
        setStatus("success");
        return;
      }

      setTimeout(poll, 2000);
    };

    poll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once premium confirmed, redirect after 3s
  useEffect(() => {
    if (status === "success") {
      const t = setTimeout(() => navigate("/upload"), 3000);
      return () => clearTimeout(t);
    }
  }, [status, navigate]);

  return (
    <div className="min-h-[calc(100vh-4rem)] flex items-center justify-center bg-white dark:bg-gray-950 px-4">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="max-w-md w-full text-center"
      >
        {status === "polling" && (
          <>
            <div className="w-16 h-16 rounded-full bg-violet-100 flex items-center justify-center mx-auto mb-5">
              <Loader2 className="w-8 h-8 text-violet-600 animate-spin" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {isVi ? "Đang xác nhận thanh toán..." : "Confirming payment..."}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {isVi ? "Vui lòng đợi trong giây lát." : "Please wait a moment."}
            </p>
          </>
        )}

        {status === "success" && (
          <>
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200 }}
              className="w-20 h-20 rounded-full bg-gradient-to-br from-amber-400 to-amber-500 flex items-center justify-center mx-auto mb-5 shadow-lg shadow-amber-200"
            >
              <Crown className="w-10 h-10 text-white" />
            </motion.div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
              {isVi ? "Chào mừng bạn đến với Premium!" : "Welcome to Premium!"}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
              {isVi
                ? "Tài khoản của bạn đã được nâng cấp. Đang chuyển đến trang upload..."
                : "Your account has been upgraded. Redirecting to upload..."}
            </p>
            <div className="flex items-center justify-center gap-4">
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span className="text-sm text-emerald-600 font-medium">
                {isVi ? "Unlimited video" : "Unlimited videos"}
              </span>
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              <span className="text-sm text-emerald-600 font-medium">
                {isVi ? "Realtime mode" : "Realtime mode"}
              </span>
            </div>
          </>
        )}

        {status === "timeout" && (
          <>
            <div className="w-16 h-16 rounded-full bg-amber-100 flex items-center justify-center mx-auto mb-5">
              <Crown className="w-8 h-8 text-amber-600" />
            </div>
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              {isVi ? "Thanh toán đang xử lý" : "Payment processing"}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
              {isVi
                ? "Thanh toán của bạn đang được xử lý. Premium sẽ được kích hoạt trong vài phút. Vui lòng refresh trang."
                : "Your payment is being processed. Premium will be activated within a few minutes. Please refresh the page."}
            </p>
            <Link
              to="/upload"
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-violet-600 text-white text-sm font-medium hover:bg-violet-700 transition-colors"
            >
              {isVi ? "Về trang Upload" : "Go to Upload"}
            </Link>
          </>
        )}
      </motion.div>
    </div>
  );
}
