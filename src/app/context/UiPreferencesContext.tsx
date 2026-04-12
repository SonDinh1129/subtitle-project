import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type AppLanguage = "en" | "vi";
export type AppTheme = "light" | "dark";

type UiPreferencesContextValue = {
  language: AppLanguage;
  setLanguage: (next: AppLanguage) => void;
  theme: AppTheme;
  setTheme: (next: AppTheme) => void;
};

const STORAGE_LANG_KEY = "app_language";
const STORAGE_THEME_KEY = "app_theme";

const UiPreferencesContext = createContext<UiPreferencesContextValue | null>(null);

function readInitialLanguage(): AppLanguage {
  const stored = localStorage.getItem(STORAGE_LANG_KEY);
  return stored === "vi" ? "vi" : "en";
}

function readInitialTheme(): AppTheme {
  const stored = localStorage.getItem(STORAGE_THEME_KEY);
  if (stored === "dark") return "dark";
  return "light";
}

export function UiPreferencesProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<AppLanguage>(readInitialLanguage);
  const [theme, setTheme] = useState<AppTheme>(readInitialTheme);

  useEffect(() => {
    localStorage.setItem(STORAGE_LANG_KEY, language);
  }, [language]);

  useEffect(() => {
    localStorage.setItem(STORAGE_THEME_KEY, theme);
    document.documentElement.classList.toggle("dark", theme === "dark");
  }, [theme]);

  const value = useMemo(
    () => ({ language, setLanguage, theme, setTheme }),
    [language, theme],
  );

  return <UiPreferencesContext.Provider value={value}>{children}</UiPreferencesContext.Provider>;
}

export function useUiPreferences() {
  const context = useContext(UiPreferencesContext);
  if (!context) {
    throw new Error("useUiPreferences must be used within UiPreferencesProvider");
  }
  return context;
}
