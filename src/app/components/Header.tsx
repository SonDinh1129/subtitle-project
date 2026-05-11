import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { Captions, Menu, X, Zap, Crown, LogOut, ChevronDown, UserCircle } from "lucide-react";
import { useUiPreferences } from "../context/UiPreferencesContext";
import { useAuth } from "../context/AuthContext";

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const { language, setLanguage, theme, setTheme } = useUiPreferences();
  const { user, isPremium, signOut } = useAuth();
  const isVi = language === "vi";

  const handleSignOut = async () => {
    setUserMenuOpen(false);
    await signOut();
    navigate("/");
  };

  const handleGoTop = () => {
    setMobileOpen(false);
    requestAnimationFrame(() => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  };

  const navLinks = [
    { label: isVi ? "Trang chủ" : "Home", href: "/" },
    { label: isVi ? "Tính năng" : "Features", href: "/#features" },
    { label: isVi ? "Giá" : "Pricing", href: "/#pricing" },
    { label: isVi ? "Tài liệu" : "Docs", href: "/#docs" },
  ];

  const isActive = (href: string) => {
    if (href === "/") return location.pathname === "/" && !location.hash;
    if (!href.startsWith("/#")) return location.pathname === href;
    const hash = href.slice(1);
    return location.pathname === "/" && location.hash === hash;
  };

  return (
    <header className="sticky top-0 z-50 bg-white/80 dark:bg-gray-950/85 backdrop-blur-md border-b border-gray-100 dark:border-gray-800 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/" onClick={handleGoTop} className="flex items-center gap-2.5 group">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-md group-hover:shadow-violet-200 transition-shadow">
              <Captions className="w-4 h-4 text-white" />
            </div>
            <span className="text-gray-900 dark:text-white tracking-tight">
              <span className="text-violet-600">Sub</span>AI
            </span>
          </Link>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-1">
            {navLinks.map((link) => (
              <Link
                key={link.label}
                to={link.href}
                onClick={link.href === "/" ? handleGoTop : undefined}
                className={`px-4 py-2 rounded-lg text-sm transition-all ${
                  isActive(link.href)
                    ? "text-violet-600 bg-violet-50"
                    : "text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-50 dark:hover:bg-gray-900"
                }`}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* CTA Buttons */}
          <div className="hidden md:flex items-center gap-3">
            <div className="flex items-center gap-2 mr-2">
              <select
                value={language}
                onChange={(e) => setLanguage(e.target.value as "en" | "vi")}
                className="text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 px-2 py-1"
                title="Language"
              >
                <option value="en">EN</option>
                <option value="vi">VN</option>
              </select>
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as "light" | "dark")}
                className="text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 px-2 py-1"
                title="Theme"
              >
                <option value="light">{isVi ? "Normal" : "Normal"}</option>
                <option value="dark">{isVi ? "Tối" : "Dark"}</option>
              </select>
            </div>

            {user ? (
              <div className="relative">
                <button
                  onClick={() => setUserMenuOpen(!userMenuOpen)}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 hover:bg-gray-50 dark:hover:bg-gray-800 transition-all text-sm text-gray-700 dark:text-gray-200"
                >
                  {isPremium && <Crown className="w-3.5 h-3.5 text-amber-500" />}
                  <span className="max-w-[140px] truncate">{user.email}</span>
                  <ChevronDown className="w-3.5 h-3.5 text-gray-400" />
                </button>
                {userMenuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-lg py-1 z-50">
                    <Link
                      to="/profile"
                      onClick={() => setUserMenuOpen(false)}
                      className="flex items-center gap-2 px-3 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors"
                    >
                      <UserCircle className="w-4 h-4" />
                      {isVi ? 'Thông tin tài khoản' : 'Account Settings'}
                    </Link>
                    {!isPremium && (
                      <Link
                        to="/upgrade"
                        onClick={() => setUserMenuOpen(false)}
                        className="flex items-center gap-2 px-4 py-2 text-sm text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors"
                      >
                        <Crown className="w-4 h-4" />
                        {isVi ? "Nâng cấp Premium" : "Upgrade to Premium"}
                      </Link>
                    )}
                    <button
                      onClick={handleSignOut}
                      className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <LogOut className="w-4 h-4" />
                      {isVi ? "Đăng xuất" : "Sign Out"}
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <>
                <Link
                  to="/signin"
                  className="text-sm text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white px-4 py-2 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-900 transition-all"
                >
                  {isVi ? "Đăng nhập" : "Sign In"}
                </Link>
                <Link
                  to="/signup"
                  className="text-sm text-white px-4 py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-700 hover:to-indigo-700 shadow-sm hover:shadow-md hover:shadow-violet-200 transition-all flex items-center gap-1.5"
                >
                  <Zap className="w-3.5 h-3.5" />
                  {isVi ? "Đăng ký" : "Sign Up"}
                </Link>
              </>
            )}
          </div>

          {/* Mobile Menu Toggle */}
          <button
            className="md:hidden p-2 rounded-lg text-gray-600 hover:bg-gray-50"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Menu */}
      {mobileOpen && (
        <div className="md:hidden border-t border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-950 px-4 pb-4 pt-2 space-y-1">
          <div className="flex items-center gap-2 px-1 py-2">
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "vi")}
              className="text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 px-2 py-1"
            >
              <option value="en">EN</option>
              <option value="vi">VN</option>
            </select>
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as "light" | "dark")}
              className="text-xs rounded-md border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 text-gray-700 dark:text-gray-200 px-2 py-1"
            >
              <option value="light">{isVi ? "Normal" : "Normal"}</option>
              <option value="dark">{isVi ? "Tối" : "Dark"}</option>
            </select>
          </div>
          {navLinks.map((link) => (
            <Link
              key={link.label}
              to={link.href}
              onClick={link.href === "/" ? handleGoTop : () => setMobileOpen(false)}
              className="block px-4 py-2 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-900"
            >
              {link.label}
            </Link>
          ))}
          <div className="pt-2 flex flex-col gap-2">
            {user ? (
              <>
                <div className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-200">
                  {isPremium && <Crown className="w-4 h-4 text-amber-500" />}
                  <span className="truncate">{user.email}</span>
                </div>
                <Link
                  to="/profile"
                  onClick={() => setMobileOpen(false)}
                  className="flex items-center gap-2 px-4 py-2 text-sm text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-900 rounded-lg"
                >
                  <UserCircle className="w-4 h-4" />
                  {isVi ? 'Thông tin tài khoản' : 'Account Settings'}
                </Link>
                {!isPremium && (
                  <Link
                    to="/upgrade"
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center justify-center gap-2 text-sm text-amber-600 py-2 rounded-lg border border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-900/20"
                  >
                    <Crown className="w-4 h-4" />
                    {isVi ? "Nâng cấp Premium" : "Upgrade to Premium"}
                  </Link>
                )}
                <button
                  onClick={handleSignOut}
                  className="flex items-center justify-center gap-2 text-sm text-gray-600 dark:text-gray-300 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
                >
                  <LogOut className="w-4 h-4" />
                  {isVi ? "Đăng xuất" : "Sign Out"}
                </button>
              </>
            ) : (
              <>
                <Link
                  to="/signin"
                  className="text-center text-sm text-gray-600 dark:text-gray-300 py-2 rounded-lg border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-900"
                  onClick={() => setMobileOpen(false)}
                >
                  {isVi ? "Đăng nhập" : "Sign In"}
                </Link>
                <Link
                  to="/signup"
                  className="text-center text-sm text-white py-2 rounded-lg bg-gradient-to-r from-violet-600 to-indigo-600"
                  onClick={() => setMobileOpen(false)}
                >
                  {isVi ? "Đăng ký" : "Sign Up"}
                </Link>
              </>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
