import { useEffect } from "react";
import { Link } from "react-router";
import { useLocation } from "react-router";
import { motion } from "motion/react";
import {
  Zap,
  Clock,
  Download,
  Star,
  ArrowRight,
  CheckCircle2,
  Languages,
  Sparkles,
  Shield,
  ChevronRight,
  Video,
  FileText,
} from "lucide-react";
import { ImageWithFallback } from "../components/figma/ImageWithFallback";
import { useUiPreferences } from "../context/UiPreferencesContext";

const features = [
  {
    icon: Zap,
    title: "Lightning Fast",
    desc: "Generate accurate subtitles in under 2 minutes for a 30-minute video using our optimized AI pipeline.",
    color: "from-amber-500 to-orange-500",
    bg: "bg-amber-50",
  },
  {
    icon: Languages,
    title: "English-Only Model",
    desc: "Focused English subtitle translation for stable quality and predictable editing.",
    color: "from-blue-500 to-cyan-500",
    bg: "bg-blue-50",
  },
  {
    icon: Languages,
    title: "Realtime Workflow",
    desc: "Open the editor immediately and refine English subtitles while processing continues.",
    color: "from-violet-500 to-purple-500",
    bg: "bg-violet-50",
  },
  {
    icon: Download,
    title: "Multiple Formats",
    desc: "Export subtitles as SRT, VTT, ASS, or burn them directly into your video file.",
    color: "from-green-500 to-emerald-500",
    bg: "bg-green-50",
  },
  {
    icon: Shield,
    title: "Secure & Private",
    desc: "Your videos are encrypted in transit and at rest. Auto-deleted after 24 hours.",
    color: "from-rose-500 to-pink-500",
    bg: "bg-rose-50",
  },
  {
    icon: Sparkles,
    title: "Smart Editing",
    desc: "AI-powered subtitle editor with auto-sync, spell check, and reading speed optimization.",
    color: "from-indigo-500 to-blue-500",
    bg: "bg-indigo-50",
  },
];


const steps = [
  {
    num: "01",
    icon: Video,
    title: "Upload Your Video",
    desc: "Drag & drop or browse to upload. Supports MP4, MOV, MKV and more.",
  },
  {
    num: "02",
    icon: Sparkles,
    title: "AI Generates Subtitles",
    desc: "Our AI transcribes and timestamps your audio with high precision.",
  },
  {
    num: "03",
    icon: FileText,
    title: "Edit & Customize",
    desc: "Fine-tune subtitles, adjust timing, change style and position.",
  },
  {
    num: "04",
    icon: Download,
    title: "Download & Share",
    desc: "Export SRT files or download your video with subtitles burned in.",
  },
];

const pricingPlans = [
  {
    name: "Free",
    price: "0₫",
    period: "forever",
    desc: "Perfect for getting started",
    features: [
      "5 videos / month",
      "Normal mode",
      "English & Vietnamese subtitles",
      "SRT export",
      "Basic subtitle editor",
    ],
    cta: "Start Free",
    featured: false,
  },
  {
    name: "Premium",
    price: "99.000₫",
    period: "/ year",
    desc: "For creators who need more",
    features: [
      "Unlimited videos",
      "Normal + Realtime mode",
      "English & Vietnamese subtitles",
      "All export formats",
      "Advanced editor",
      "Priority processing",
    ],
    cta: "Upgrade to Premium",
    featured: true,
  },
];

const stats = [
  { value: "10M+", label: "Videos processed" },
  { value: "Free", label: "Start at no cost" },
  { value: "< 2min", label: "Avg. processing time" },
  { value: "99k₫/yr", label: "Premium — less than 1 coffee/mo" },
];


export function LandingPage() {
  const location = useLocation();
  const { language } = useUiPreferences();
  const isVi = language === "vi";
  const localizedFeatures = isVi
    ? [
        {
          ...features[0],
          title: "Tốc độ vượt trội",
          desc: "Tạo phụ đề chính xác cho video 30 phút chỉ trong dưới 2 phút với pipeline AI tối ưu.",
        },
        {
          ...features[1],
          title: "Mô hình tiếng Anh",
          desc: "Tập trung xử lý phụ đề tiếng Anh để đảm bảo chất lượng ổn định và dễ chỉnh sửa.",
        },
        {
          ...features[2],
          title: "Luồng Realtime",
          desc: "Vào editor ngay và chỉnh dần phụ đề tiếng Anh trong khi hệ thống vẫn xử lý.",
        },
        {
          ...features[3],
          title: "Nhiều định dạng",
          desc: "Xuất phụ đề dạng SRT, VTT, ASS hoặc burn trực tiếp vào video.",
        },
        {
          ...features[4],
          title: "Bảo mật & riêng tư",
          desc: "Video được mã hóa khi truyền và lưu trữ. Tự động xóa sau 24 giờ.",
        },
        {
          ...features[5],
          title: "Chỉnh sửa thông minh",
          desc: "Editor hỗ trợ đồng bộ thời gian, sửa chính tả và tối ưu tốc độ đọc.",
        },
      ]
    : features;

  const localizedPricingPlans = isVi
    ? [
        {
          ...pricingPlans[0],
          name: "Miễn phí",
          period: "mãi mãi",
          desc: "Phù hợp để bắt đầu",
          features: [
            "5 video / tháng",
            "Chế độ Normal",
            "Phụ đề Anh & Việt",
            "Xuất SRT",
            "Editor cơ bản",
          ],
          cta: "Bắt đầu miễn phí",
        },
        {
          ...pricingPlans[1],
          name: "Premium",
          period: "/ năm",
          desc: "Dành cho creator cần nhiều hơn",
          features: [
            "Không giới hạn video",
            "Normal + Realtime mode",
            "Phụ đề Anh & Việt",
            "Đầy đủ định dạng xuất",
            "Editor nâng cao",
            "Ưu tiên xử lý",
          ],
          cta: "Nâng cấp Premium",
        },
      ]
    : pricingPlans;


  const localizedStats = isVi
    ? [
        { value: "10M+", label: "Video đã xử lý" },
        { value: "Miễn phí", label: "Bắt đầu không tốn phí" },
        { value: "< 2 phút", label: "Thời gian xử lý trung bình" },
        { value: "99k₫/năm", label: "Premium — chưa đến 1 ly cà phê/tháng" },
      ]
    : stats;


  useEffect(() => {
    if (!location.hash) return;
    const id = location.hash.replace("#", "");
    const el = document.getElementById(id);
    if (!el) return;

    requestAnimationFrame(() => {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, [location.hash]);

  return (
    <div className="overflow-x-hidden bg-white dark:bg-gray-950">
      {/* ─── Hero Section ─── */}
      <section className="relative pt-20 pb-28 px-4 sm:px-6 lg:px-8 overflow-hidden">
        {/* Background gradient blobs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute -top-40 -right-32 w-[600px] h-[600px] rounded-full bg-gradient-to-br from-violet-100 to-indigo-100 opacity-60 blur-3xl" />
          <div className="absolute -bottom-20 -left-32 w-[500px] h-[500px] rounded-full bg-gradient-to-br from-blue-100 to-cyan-100 opacity-50 blur-3xl" />
        </div>

        <div className="relative max-w-7xl mx-auto">
          <div className="text-center max-w-4xl mx-auto">
            {/* Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5 }}
              className="inline-flex items-center gap-2 bg-violet-50 border border-violet-200 text-violet-700 text-sm px-4 py-1.5 rounded-full mb-6"
            >
              <Sparkles className="w-3.5 h-3.5" />
              {isVi ? "Vận hành bởi mô hình Whisper AI" : "Powered by state-of-the-art Whisper AI"}
              <ChevronRight className="w-3.5 h-3.5" />
            </motion.div>

            {/* Headline */}
            <motion.h1
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="text-5xl sm:text-6xl lg:text-7xl text-gray-900 dark:text-white tracking-tight mb-6 leading-[1.1]"
            >
              {isVi ? "Tạo phụ đề cho" : "Generate subtitles for"}{" "}
              <span className="bg-gradient-to-r from-violet-600 to-indigo-600 bg-clip-text text-transparent">
                {isVi ? "video bất kỳ" : "any video"}
              </span>{" "}
              {isVi ? "tự động bằng AI" : "automatically with AI"}
            </motion.h1>

            {/* Subtext */}
            <motion.p
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="text-xl text-gray-500 dark:text-gray-200 max-w-2xl mx-auto mb-10 leading-relaxed"
            >
              {isVi
              ? "Tải video lên và nhận phụ đề canh thời gian chính xác trong vài phút. Bản phát hành hiện tại tập trung vào xử lý tiếng Anh, có realtime editor và nhiều định dạng export."
                : "Upload your video and get accurate, perfectly timed subtitles in minutes. Current release focuses on English subtitle translation with realtime editing and multiple export formats."}
            </motion.p>

            {/* CTA Buttons */}
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="flex flex-col sm:flex-row items-center justify-center gap-4"
            >
              <Link
                to="/upload"
                className="flex items-center gap-2 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 text-white px-7 py-3.5 rounded-xl shadow-lg shadow-violet-200 hover:shadow-xl hover:shadow-violet-300 transition-all"
              >
                <Zap className="w-4 h-4" />
                {isVi ? "Tải video — Miễn phí" : "Upload Video — It's Free"}
                <ArrowRight className="w-4 h-4" />
              </Link>
            </motion.div>

            {/* Trust badges */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6, delay: 0.5 }}
              className="flex flex-wrap items-center justify-center gap-6 mt-10 text-sm text-gray-400"
            >
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                No credit card required
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                30 min free every month
              </span>
              <span className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500" />
                Cancel anytime
              </span>
            </motion.div>
          </div>

          {/* Hero Visual */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4 }}
            className="mt-16 relative max-w-5xl mx-auto"
          >
            <div className="relative rounded-2xl overflow-hidden shadow-2xl shadow-gray-200 border border-gray-100">
              {/* Mock app screenshot */}
              <div className="bg-gray-900 px-3 py-2 flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                <span className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="w-3 h-3 rounded-full bg-green-500" />
                <span className="flex-1 mx-4 bg-gray-700 rounded text-xs text-gray-400 px-3 py-0.5 text-center">
                  app.subai.io/editor
                </span>
              </div>
              <div className="relative">
                <ImageWithFallback
                  src="https://images.unsplash.com/photo-1764557175375-9e2bea91530e?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHx2aWRlbyUyMGVkaXRpbmclMjB3b3Jrc3BhY2UlMjBwcm9mZXNzaW9uYWx8ZW58MXx8fHwxNzczNDEzMjcyfDA&ixlib=rb-4.1.0&q=80&w=1080"
                  alt="SubAI Editor Interface"
                  className="w-full h-72 md:h-96 object-cover"
                />
                {/* Subtitle overlay demo */}
                <div className="absolute bottom-8 left-1/2 -translate-x-1/2 w-max">
                  <div className="bg-black/75 text-white text-lg px-6 py-2 rounded-lg backdrop-blur-sm border border-white/10">
                    Welcome to the future of subtitle generation
                  </div>
                </div>
                {/* AI badge overlay */}
                <div className="absolute top-4 right-4 bg-white/90 backdrop-blur-sm rounded-xl px-3 py-2 shadow-lg flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                  <span className="text-sm text-gray-700">AI Processing Active</span>
                </div>
              </div>
            </div>

            {/* Floating stat cards */}
            <div className="absolute -left-6 top-1/2 -translate-y-1/2 hidden lg:block">
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-4 w-44">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center">
                    <Star className="w-4 h-4 text-amber-500" />
                  </div>
                  <span className="text-sm text-gray-500">Pricing</span>
                </div>
                <div className="text-2xl text-gray-900">99k₫/yr</div>
                <div className="text-xs text-green-600 mt-1">↓ Free tier available</div>
              </div>
            </div>
            <div className="absolute -right-6 top-1/3 hidden lg:block">
              <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-4 w-48">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-8 h-8 rounded-lg bg-violet-50 flex items-center justify-center">
                    <Clock className="w-4 h-4 text-violet-500" />
                  </div>
                  <span className="text-sm text-gray-500">Avg. Speed</span>
                </div>
                <div className="text-2xl text-gray-900">1:47</div>
                <div className="text-xs text-violet-600 mt-1">per 30min video</div>
              </div>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ─── Stats Bar ─── */}
      <section className="border-y border-gray-100 dark:border-gray-800 bg-gray-50 dark:bg-gray-900 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8">
            {localizedStats.map((stat, i) => (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="text-center"
              >
                <div className="text-3xl text-gray-900 dark:text-gray-100 mb-1">{stat.value}</div>
                <div className="text-sm text-gray-500 dark:text-gray-400">{stat.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── How It Works ─── */}
      <section id="features" className="scroll-mt-24 py-24 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-950">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-sm text-violet-600 bg-violet-50 dark:bg-violet-900/30 dark:border-violet-700 px-3 py-1 rounded-full border border-violet-100">
              {isVi ? "Quy trình" : "How It Works"}
            </span>
            <h2 className="text-4xl text-gray-900 dark:text-gray-100 mt-4 mb-4 tracking-tight">
              {isVi ? "Tạo phụ đề chỉ với 4 bước" : "Subtitles in 4 simple steps"}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              {isVi
                ? "Từ upload đến download chỉ trong vài phút, không cần kiến thức kỹ thuật."
                : "From upload to download in minutes — no technical knowledge required."}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
            {(isVi
              ? [
                  { ...steps[0], title: "Tải video", desc: "Kéo thả hoặc chọn tệp. Hỗ trợ MP4, MOV, MKV..." },
                  { ...steps[1], title: "AI tạo phụ đề", desc: "AI nhận dạng giọng nói và gắn mốc thời gian chính xác." },
                  { ...steps[2], title: "Chỉnh sửa", desc: "Tinh chỉnh nội dung, thời gian hiển thị, kiểu chữ và vị trí." },
                  { ...steps[3], title: "Xuất và chia sẻ", desc: "Xuất SRT hoặc tải video đã burn phụ đề." },
                ]
              : steps).map((step, i) => (
              <motion.div
                key={step.num}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className="relative bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="text-5xl text-gray-100 dark:text-gray-800 absolute top-4 right-5 select-none pointer-events-none">
                  {step.num}
                </div>
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center mb-4">
                  <step.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-gray-900 dark:text-gray-100 mb-2">{step.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{step.desc}</p>
                {i < steps.length - 1 && (
                  <div className="hidden lg:block absolute top-1/2 -right-3 z-10">
                    <ChevronRight className="w-6 h-6 text-gray-300" />
                  </div>
                )}
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── Features Grid ─── */}
      <section className="py-24 px-4 sm:px-6 lg:px-8 bg-gray-50 dark:bg-gray-900">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-sm text-violet-600 bg-violet-50 dark:bg-violet-900/30 dark:border-violet-700 px-3 py-1 rounded-full border border-violet-100">
              {isVi ? "Tính năng" : "Features"}
            </span>
            <h2 className="text-4xl text-gray-900 dark:text-gray-100 mt-4 mb-4 tracking-tight">
              {isVi ? "Đầy đủ công cụ để tạo phụ đề chất lượng" : "Everything you need for perfect subtitles"}
            </h2>
            <p className="text-gray-500 dark:text-gray-400 max-w-xl mx-auto">
              {isVi
                ? "Bộ công cụ chuyên nghiệp giúp tạo phụ đề nhanh, chính xác và dễ sử dụng."
                : "Professional tools that make subtitle creation fast, accurate, and accessible."}
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {localizedFeatures.map((feat, i) => (
              <motion.div
                key={feat.title}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.08 }}
                className="bg-white dark:bg-gray-950 border border-gray-100 dark:border-gray-800 rounded-2xl p-6 shadow-sm hover:shadow-lg hover:-translate-y-0.5 transition-all"
              >
                <div
                  className={`w-10 h-10 rounded-xl bg-gradient-to-br ${feat.color} flex items-center justify-center mb-4`}
                >
                  <feat.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="text-gray-900 dark:text-gray-100 mb-2">{feat.title}</h3>
                <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed">{feat.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>


      {/* ─── Pricing ─── */}
      <section id="pricing" className="scroll-mt-24 py-24 px-4 sm:px-6 lg:px-8 bg-white dark:bg-gray-950">
        <div className="max-w-7xl mx-auto">
          <div className="text-center mb-16">
            <span className="text-sm text-violet-600 bg-violet-50 dark:bg-violet-900/30 dark:border-violet-700 px-3 py-1 rounded-full border border-violet-100">
              {isVi ? "Bảng giá" : "Pricing"}
            </span>
            <h2 className="text-4xl text-gray-900 dark:text-gray-100 mt-4 mb-4 tracking-tight">
              {isVi ? "Bảng giá đơn giản, minh bạch" : "Simple, transparent pricing"}
            </h2>
            <p className="text-gray-500 dark:text-gray-400">{isVi ? "Bắt đầu miễn phí, nâng cấp khi cần." : "Start free, upgrade when you need more."}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            {localizedPricingPlans.map((plan, i) => (
              <motion.div
                key={plan.name}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.1 }}
                className={`relative rounded-2xl p-6 ${
                  plan.featured
                    ? "bg-gradient-to-b from-violet-600 to-indigo-700 text-white shadow-xl shadow-violet-200"
                    : "bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm"
                }`}
              >
                {plan.featured && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <span className="bg-amber-400 text-amber-900 text-xs px-3 py-1 rounded-full">
                      Most Popular
                    </span>
                  </div>
                )}
                <div className="mb-5">
                  <h3 className={plan.featured ? "text-white" : "text-gray-900 dark:text-gray-100"}>
                    {plan.name}
                  </h3>
                  <p className={`text-xs mt-1 ${plan.featured ? "text-violet-200" : "text-gray-400 dark:text-gray-500"}`}>
                    {plan.desc}
                  </p>
                  <div className="mt-4 flex items-baseline gap-1">
                    <span
                      className={`text-4xl ${plan.featured ? "text-white" : "text-gray-900 dark:text-gray-100"}`}
                    >
                      {plan.price}
                    </span>
                    <span className={`text-sm ${plan.featured ? "text-violet-200" : "text-gray-400"}`}>
                      /{plan.period}
                    </span>
                  </div>
                </div>
                <ul className="space-y-2.5 mb-6">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <CheckCircle2
                        className={`w-4 h-4 flex-shrink-0 ${
                          plan.featured ? "text-violet-300" : "text-violet-500"
                        }`}
                      />
                      <span className={plan.featured ? "text-violet-100" : "text-gray-600 dark:text-gray-300"}>
                        {f}
                      </span>
                    </li>
                  ))}
                </ul>
                <Link
                  to={plan.featured ? "/upgrade" : "/upload"}
                  className={`block text-center text-sm py-2.5 rounded-xl transition-all ${
                    plan.featured
                      ? "bg-white text-violet-700 hover:bg-violet-50"
                      : "bg-violet-600 text-white hover:bg-violet-700"
                  }`}
                >
                  {plan.cta}
                </Link>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}