"use client";

/* Medical source figures are pre-compressed WebP assets and should be served without transformation. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import { Maximize2, X } from "lucide-react";

export default function QuestionMedia({ images, questionId }: { images: string[]; questionId: string }) {
  const [active, setActive] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active) return;
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape") setActive(null);
      if (event.key === "Tab") {
        event.preventDefault();
        closeRef.current?.focus();
      }
    };
    const frame = requestAnimationFrame(() => closeRef.current?.focus());
    window.addEventListener("keydown", close);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("keydown", close);
      previousFocus.current?.focus();
    };
  }, [active]);

  if (!images.length) return null;
  return (
    <>
      <div className={`question-media ${images.length > 1 ? "media-grid" : ""}`}>
        {images.map((src, index) => (
          <button key={src} onClick={(event) => { previousFocus.current = event.currentTarget; setActive(src); }} aria-label={`放大 ${questionId} 原題圖片 ${index + 1}`}>
            <img src={src} alt={`${questionId} 原題圖片 ${index + 1}`} loading="lazy" />
            <span><Maximize2 size={15} />檢視原圖</span>
          </button>
        ))}
      </div>
      {active && (
        <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={`${questionId} 圖片放大檢視`} onClick={() => setActive(null)}>
          <button ref={closeRef} className="lightbox-close" aria-label="關閉圖片" onClick={() => setActive(null)}><X /></button>
          <img src={active} alt={`${questionId} 原題圖片放大檢視`} onClick={(event) => event.stopPropagation()} />
        </div>
      )}
    </>
  );
}
