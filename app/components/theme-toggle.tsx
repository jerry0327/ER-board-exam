"use client";

import { Check, Circle, Moon, Sun } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { subscribeToMediaQuery } from "../lib/media-query";
import { THEME_STORAGE_KEY, type ThemeMode } from "../lib/theme";

const themeOptions: { value: ThemeMode; label: string; description: string; icon: typeof Sun }[] = [
  { value: "light", label: "淺色", description: "明亮紙張配色", icon: Sun },
  { value: "dark", label: "深色", description: "柔和深綠黑底", icon: Moon },
  { value: "black", label: "純黑", description: "OLED 真黑背景", icon: Circle },
];

function applyTheme(mode: ThemeMode) {
  const colorScheme = mode === "light" ? "light" : "dark";
  const themeColor = mode === "light" ? "#f1ede4" : mode === "black" ? "#000000" : "#121714";
  document.documentElement.dataset.theme = colorScheme;
  document.documentElement.dataset.themeMode = mode;
  document.documentElement.style.colorScheme = colorScheme;
  document.getElementById("app-theme-color")?.setAttribute("content", themeColor);
}

function updateTriggerState(button: HTMLButtonElement | null, mode: ThemeMode) {
  if (!button) return;
  const label = themeOptions.find((option) => option.value === mode)?.label ?? "淺色";
  button.setAttribute("aria-label", `顯示模式：${label}。開啟選單`);
  button.title = `顯示模式：${label}`;
}

function updateOptionStates(container: HTMLDivElement | null, mode: ThemeMode) {
  container?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]').forEach((option) => {
    option.setAttribute("aria-checked", String(option.dataset.themeValue === mode));
  });
}

function getCurrentTheme(): ThemeMode {
  const mode = document.documentElement.dataset.themeMode;
  return mode === "dark" || mode === "black" ? mode : "light";
}

export default function ThemeToggle() {
  const pickerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const currentThemeRef = useRef<ThemeMode>("light");
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    currentThemeRef.current = getCurrentTheme();
    updateTriggerState(triggerRef.current, currentThemeRef.current);

    const followSystemTheme = (event: MediaQueryListEvent) => {
      try {
        const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
        if (saved === "light" || saved === "dark" || saved === "black") return;
      } catch {
        // The theme can still follow the system when storage is unavailable.
      }
      const nextTheme: ThemeMode = event.matches ? "dark" : "light";
      currentThemeRef.current = nextTheme;
      applyTheme(nextTheme);
      updateTriggerState(triggerRef.current, nextTheme);
      setMenuOpen(false);
    };

    return subscribeToMediaQuery(media, followSystemTheme);
  }, []);

  useEffect(() => {
    if (!menuOpen) return;

    updateOptionStates(pickerRef.current, currentThemeRef.current);
    const selected = pickerRef.current?.querySelector<HTMLButtonElement>('[role="menuitemradio"][aria-checked="true"]');
    selected?.focus();

    const closeOnOutsidePress = (event: PointerEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const closeOnEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeOnOutsidePress);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePress);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const selectTheme = (nextTheme: ThemeMode) => {
    currentThemeRef.current = nextTheme;
    applyTheme(nextTheme);
    updateTriggerState(triggerRef.current, nextTheme);
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // A blocked storage API should not prevent the visible theme change.
    }
    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  const moveOptionFocus = (event: ReactKeyboardEvent<HTMLButtonElement>, value: ThemeMode) => {
    const currentIndex = themeOptions.findIndex((option) => option.value === value);
    let nextIndex = currentIndex;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") nextIndex = (currentIndex + 1) % themeOptions.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") nextIndex = (currentIndex - 1 + themeOptions.length) % themeOptions.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = themeOptions.length - 1;
    else return;
    event.preventDefault();
    const options = pickerRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]');
    options?.[nextIndex]?.focus();
  };

  return (
    <div className="theme-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
        className="icon-button theme-toggle"
        type="button"
        aria-label="顯示模式：淺色。開啟選單"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        title="顯示模式：淺色"
        onClick={() => setMenuOpen((open) => !open)}
      >
        <Sun className="theme-icon theme-icon-light" aria-hidden="true" />
        <Moon className="theme-icon theme-icon-dark" aria-hidden="true" />
        <Circle className="theme-icon theme-icon-black" aria-hidden="true" />
      </button>

      {menuOpen && (
        <div className="theme-menu overlay-panel" role="menu" aria-label="選擇顯示模式">
          {themeOptions.map(({ value, label, description, icon: Icon }) => (
            <button
              key={value}
              type="button"
              role="menuitemradio"
              aria-checked="false"
              data-theme-value={value}
              onClick={() => selectTheme(value)}
              onKeyDown={(event) => moveOptionFocus(event, value)}
            >
              <Icon aria-hidden="true" />
              <span><strong>{label}</strong><small>{description}</small></span>
              <Check className="theme-choice-check" aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
