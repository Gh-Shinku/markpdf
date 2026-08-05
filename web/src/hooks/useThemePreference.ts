import { useEffect, useState } from "react";

const THEME_STORAGE_KEY = "bookmark.theme";

export type ThemePreference = "system" | "light" | "dark";

function readThemePreference(): ThemePreference {
  const value = window.localStorage.getItem(THEME_STORAGE_KEY);
  return value === "light" || value === "dark" || value === "system" ? value : "system";
}

export function useThemePreference() {
  const [preference, setPreference] = useState<ThemePreference>(readThemePreference);
  const [prefersDark, setPrefersDark] = useState(() => window.matchMedia("(prefers-color-scheme: dark)").matches);
  const theme = preference === "system" ? (prefersDark ? "dark" : "light") : preference;

  useEffect(() => {
    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => setPrefersDark(mediaQuery.matches);
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem(THEME_STORAGE_KEY, preference);
  }, [preference, theme]);

  return { preference, setPreference, theme };
}
