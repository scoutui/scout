"use client";

import * as React from "react";

export type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "theme";
const MEDIA_QUERY = "(prefers-color-scheme: dark)";

type ThemeContextValue = {
  theme: Theme;
  setTheme: (theme: Theme) => void;
};

const ThemeContext = React.createContext<ThemeContextValue | null>(null);

function isTheme(value: string | null): value is Theme {
  return value === "light" || value === "dark" || value === "system";
}

/**
 * Whether the dark palette is active for a preference. Mirrors the inline
 * script in the root layout that runs before paint: keep the two in sync, or
 * the page flashes and hydration mismatches.
 */
function prefersDark(theme: Theme): boolean {
  if (theme === "dark") return true;
  if (theme === "light") return false;
  return window.matchMedia(MEDIA_QUERY).matches;
}

function applyTheme(theme: Theme): void {
  document.documentElement.classList.toggle("dark", prefersDark(theme));
}

/**
 * Apply a theme change from the user or the OS instantly. Many elements carry
 * `transition-colors`, so transitions are suppressed for one frame to make the
 * whole UI switch at once (as next-themes' `disableTransitionOnChange` does).
 * The initial mount uses applyTheme, since the pre-paint script already set
 * the theme.
 */
function applyThemeImmediate(theme: Theme): void {
  const root = document.documentElement;
  root.classList.add("theme-switching");
  applyTheme(theme);
  // Force the new colours to commit while transitions are still suppressed,
  // then re-enable next frame so later hovers/focus still animate normally.
  void root.offsetWidth;
  window.requestAnimationFrame(() => root.classList.remove("theme-switching"));
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  // Read the stored preference so the first client render agrees with the class
  // the pre-paint script set.
  const [theme, setThemeState] = React.useState<Theme>(() => {
    if (typeof window === "undefined") return "system";
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isTheme(stored) ? stored : "system";
  });

  const setTheme = React.useCallback((next: Theme) => {
    window.localStorage.setItem(STORAGE_KEY, next);
    applyThemeImmediate(next);
    setThemeState(next);
  }, []);

  React.useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  // Track OS preference only while following the system.
  React.useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia(MEDIA_QUERY);
    const onChange = () => applyThemeImmediate("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);

  const value = React.useMemo<ThemeContextValue>(() => ({ theme, setTheme }), [theme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = React.useContext(ThemeContext);
  if (!context) throw new Error("useTheme must be used within a ThemeProvider");
  return context;
}

/**
 * The preference resolved to the palette on screen, for embedded surfaces that
 * theme themselves (ReactFlow's colorMode). Uses the provider's media query and
 * follows OS changes while the preference is "system".
 */
export function useResolvedTheme(): "light" | "dark" {
  const { theme } = React.useContext(ThemeContext) ?? { theme: "system" as Theme };
  const [systemDark, setSystemDark] = React.useState<boolean>(() =>
    typeof window === "undefined" ? false : window.matchMedia(MEDIA_QUERY).matches,
  );
  React.useEffect(() => {
    if (theme !== "system") return;
    const media = window.matchMedia(MEDIA_QUERY);
    const onChange = () => setSystemDark(media.matches);
    setSystemDark(media.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [theme]);
  if (theme === "system") return systemDark ? "dark" : "light";
  return theme;
}
