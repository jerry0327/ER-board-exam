export const THEME_STORAGE_KEY = "emergency-board-theme-v1";
export type ThemeMode = "light" | "dark" | "black";

export const THEME_INIT_SCRIPT = String.raw`
(() => {
  const storageKey = "${THEME_STORAGE_KEY}";
  let savedTheme = null;
  try { savedTheme = window.localStorage.getItem(storageKey); } catch {}
  const followsDarkSystemTheme = window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
  const mode = savedTheme === "light" || savedTheme === "dark" || savedTheme === "black"
    ? savedTheme
    : savedTheme === "editorial"
      ? "light"
      : savedTheme === "instrument"
        ? "dark"
        : followsDarkSystemTheme ? "dark" : "light";
  if (savedTheme === "editorial" || savedTheme === "instrument") {
    try { window.localStorage.setItem(storageKey, mode); } catch {}
  }
  const colorScheme = mode === "light" ? "light" : "dark";
  const themeColor = mode === "light" ? "#f1ede4" : mode === "black" ? "#000000" : "#121714";
  document.documentElement.dataset.theme = colorScheme;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = colorScheme;
  document.getElementById("app-theme-color")?.setAttribute("content", themeColor);
})();`;
