import { motion } from "motion/react";
import { Sparkles, Captions, Globe2, Wand2 } from "lucide-react";
import { useUiPreferences } from "../context/UiPreferencesContext";

export function AuthRightPanel() {
  const { language } = useUiPreferences();
  const isVi = language === "vi";
  const featureItems = isVi
    ? [
        "Nhận dạng tiếng Anh với mốc thời gian ổn định",
        "Quy trình dịch tập trung cho tiếng Anh",
        "Xuất nhanh SRT hoặc video đã burn phụ đề",
      ]
    : [
        "English transcription with stable timing",
        "English-only translation workflow",
        "Fast export to SRT or burned-in video",
      ];

  return (
    <div className="hidden lg:flex lg:w-[48%] relative overflow-hidden bg-slate-950">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_22%,rgba(167,139,250,0.28),transparent_42%),radial-gradient(circle_at_80%_70%,rgba(56,189,248,0.24),transparent_46%),linear-gradient(135deg,#0f172a,#111827_45%,#1f2937)]" />
      <div className="absolute inset-0 opacity-25 [background:linear-gradient(120deg,transparent_0%,rgba(255,255,255,0.12)_45%,transparent_100%)]" />

      <div className="relative z-10 w-full h-full p-10 xl:p-14 flex flex-col justify-between text-white">
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55 }}
          className="inline-flex items-center gap-2 self-start rounded-full border border-white/20 bg-white/10 px-4 py-1.5"
        >
          <Sparkles className="w-4 h-4 text-cyan-300" />
          <span className="text-xs tracking-[0.08em] uppercase text-white/85">{isVi ? "SubAI Studio" : "SubAI Studio"}</span>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.65, delay: 0.08 }}
          className="max-w-lg"
        >
          <h2 className="text-4xl xl:text-5xl leading-tight font-semibold tracking-tight">
            {isVi
              ? "Tạo phụ đề tiếng Anh gọn gàng trong một quy trình tập trung."
              : "Build clean English subtitles in one focused workflow."}
          </h2>
          <p className="mt-4 text-sm xl:text-base text-white/75 leading-relaxed">
            {isVi
              ? "Giữ mọi thứ trong một nơi: nhận dạng, dịch sang tiếng Anh, chỉnh sửa và xuất phụ đề hoàn chỉnh chỉ trong vài phút."
              : "Keep everything in one place: transcribe, translate to English, edit, and export polished captions in minutes."}
          </p>

          <div className="mt-8 space-y-3">
            {featureItems.map((item) => (
              <div key={item} className="flex items-start gap-3 rounded-xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
                <Wand2 className="w-4 h-4 mt-0.5 text-violet-200 shrink-0" />
                <span className="text-sm text-white/90">{item}</span>
              </div>
            ))}
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.75, delay: 0.2 }}
          className="flex items-center justify-between rounded-2xl border border-white/15 bg-black/20 px-4 py-3"
        >
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-white/10 flex items-center justify-center border border-white/20">
              <Captions className="w-4 h-4 text-violet-200" />
            </div>
            <span className="text-xs text-white/75">{isVi ? "Được nhà sáng tạo toàn cầu tin dùng" : "Trusted by creators worldwide"}</span>
          </div>
          <div className="flex items-center gap-1 text-cyan-200 text-xs">
            <Globe2 className="w-3.5 h-3.5" />
            {isVi ? "Mô hình chỉ tiếng Anh" : "English-only model"}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
