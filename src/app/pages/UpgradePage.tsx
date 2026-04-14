import { useState } from "react";
import { Link } from "react-router";
import { motion } from "motion/react";
import { Crown, Check, Zap, Infinity, Radio, Download } from "lucide-react";
import { useUiPreferences } from "../context/UiPreferencesContext";
import { useAuth } from "../context/AuthContext";

const BASE = (import.meta.env.VITE_API_URL ?? "http://localhost:5000/api").replace(/\/$/, "");

export function UpgradePage() {
  const { language } = useUiPreferences();
  const { session, isPremium } = useAuth();
  const isVi = language === "vi";
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpgrade = async () => {
    if (!session) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/payment/create-order`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session.access_token}`,
        },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to create payment order");
        return;
      }
      window.location.href = data.payment_url;
    } catch {
      setError(isVi ? "Đã xảy ra lỗi. Vui lòng thử lại." : "An error occurred. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const freeFeatures = isVi
    ? ["5 video/tháng", "Chế độ Normal", "Tải SRT", "Export video burned subtitle"]
    : ["5 videos/month", "Normal mode", "Download SRT", "Export burned subtitle video"];

  const premiumFeatures = isVi
    ? ["Không giới hạn video", "Chế độ Realtime (stream kết quả)", "Tất cả tính năng Free", "Ưu tiên hỗ trợ"]
    : ["Unlimited videos", "Realtime mode (stream results)", "All Free features", "Priority support"];

  return (
    <div className="min-h-[calc(100vh-4rem)] bg-gradient-to-b from-gray-50 to-white dark:from-gray-950 dark:to-gray-900 py-16 px-4">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-amber-50 border border-amber-200 text-amber-700 text-sm font-medium mb-4">
            <Crown className="w-4 h-4" />
            {isVi ? "Nâng cấp Premium" : "Upgrade to Premium"}
          </div>
          <h1 className="text-4xl font-bold text-gray-900 dark:text-white tracking-tight mb-3">
            {isVi ? "Mở khóa toàn bộ tính năng" : "Unlock everything"}
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-lg">
            {isVi ? "Một lần thanh toán, dùng mãi mãi." : "One-time payment, use forever."}
          </p>
        </motion.div>

        {/* Pricing Cards */}
        <div className="grid md:grid-cols-2 gap-6 mb-10">
          {/* Free */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.1 }}
            className="rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 p-6"
          >
            <div className="mb-5">
              <p className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-1">Free</p>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">0đ</span>
              </div>
            </div>
            <ul className="space-y-3 mb-6">
              {freeFeatures.map((f) => (
                <li key={f} className="flex items-center gap-2.5 text-sm text-gray-600 dark:text-gray-300">
                  <Check className="w-4 h-4 text-emerald-500 shrink-0" />
                  {f}
                </li>
              ))}
            </ul>
            <div className="mt-auto pt-2">
              <Link
                to="/upload"
                className="block text-center w-full py-2.5 rounded-xl border border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 text-sm font-medium hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                {isVi ? "Đang dùng" : "Current plan"}
              </Link>
            </div>
          </motion.div>

          {/* Premium */}
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.15 }}
            className="rounded-2xl border-2 border-violet-500 bg-gradient-to-br from-violet-50 to-indigo-50 dark:from-violet-900/20 dark:to-indigo-900/20 dark:border-violet-500 p-6 relative overflow-hidden"
          >
            <div className="absolute top-4 right-4">
              <span className="text-xs px-2.5 py-1 rounded-full bg-violet-600 text-white font-medium">
                {isVi ? "Phổ biến nhất" : "Most popular"}
              </span>
            </div>

            <div className="mb-5">
              <div className="flex items-center gap-2 mb-1">
                <Crown className="w-4 h-4 text-amber-500" />
                <p className="text-sm font-medium text-violet-700 dark:text-violet-300">Premium</p>
              </div>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-bold text-gray-900 dark:text-white">99.000đ</span>
                <span className="text-sm text-gray-500 dark:text-gray-400">{isVi ? " / vĩnh viễn" : " / forever"}</span>
              </div>
            </div>

            <ul className="space-y-3 mb-6">
              {[
                { icon: Infinity, text: premiumFeatures[0] },
                { icon: Radio, text: premiumFeatures[1] },
                { icon: Check, text: premiumFeatures[2] },
                { icon: Download, text: premiumFeatures[3] },
              ].map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-center gap-2.5 text-sm text-gray-700 dark:text-gray-200">
                  <Icon className="w-4 h-4 text-violet-600 shrink-0" />
                  {text}
                </li>
              ))}
            </ul>

            {error && (
              <div className="mb-3 text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                {error}
              </div>
            )}

            {isPremium ? (
              <div className="flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-emerald-500 text-white text-sm font-medium">
                <Crown className="w-4 h-4" />
                {isVi ? "Đã là Premium" : "Already Premium"}
              </div>
            ) : (
              <button
                onClick={handleUpgrade}
                disabled={isLoading || !session}
                className="w-full flex items-center justify-center gap-2 py-3 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 text-white font-semibold text-sm hover:from-violet-700 hover:to-indigo-700 disabled:opacity-70 disabled:cursor-not-allowed transition-all shadow-md shadow-violet-200 hover:shadow-lg"
              >
                {isLoading ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                    {isVi ? "Đang xử lý..." : "Processing..."}
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4" />
                    {isVi ? "Nâng cấp ngay — 99.000đ" : "Upgrade now — 99,000₫"}
                  </>
                )}
              </button>
            )}
          </motion.div>
        </div>

        <p className="text-center text-xs text-gray-400 dark:text-gray-500">
          {isVi
            ? "Thanh toán an toàn qua PayOS (QR, Momo, ZaloPay, thẻ nội địa). Không hoàn tiền sau khi kích hoạt."
            : "Secure payment via PayOS (QR, Momo, ZaloPay, local cards). No refunds after activation."}
        </p>
      </div>
    </div>
  );
}
