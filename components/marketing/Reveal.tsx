'use client';

import { useEffect, useRef, type ReactNode } from "react";

/**
 * Lightweight scroll reveal — IntersectionObserver only.
 *
 * - Animates transform + opacity (compositor-friendly, no layout work).
 * - Fires once per element, then unobserves (no scroll listeners).
 * - If IntersectionObserver is unavailable, content is shown as-is.
 * - `prefers-reduced-motion` is respected in CSS (static, fully visible).
 */
export default function Reveal({
  children,
  className,
  delay = 0,
  id,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-visible");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -8% 0px" }
    );
    io.observe(el);
    // Fallback: if the observer never fires (e.g. headless renderers,
    // stalled frames), reveal anyway so content is never stuck invisible.
    const fallback = window.setTimeout(() => {
      el.classList.add("is-visible");
      io.disconnect();
    }, 2500);
    return () => {
      window.clearTimeout(fallback);
      io.disconnect();
    };
  }, []);

  return (
    <div
      ref={ref}
      id={id}
      className={`salpa-reveal${className ? ` ${className}` : ""}`}
      style={delay ? { transitionDelay: `${delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
