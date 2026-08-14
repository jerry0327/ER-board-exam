"use client";

import { useEffect, useState } from "react";

/** Keeps due-state views current without a per-component render loop. */
export function useMinuteClock() {
  const [now, setNow] = useState(() => new Date().toISOString());

  useEffect(() => {
    const refresh = () => setNow(new Date().toISOString());
    const refreshWhenVisible = () => { if (document.visibilityState === "visible") refresh(); };
    const interval = window.setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, []);

  return now;
}
