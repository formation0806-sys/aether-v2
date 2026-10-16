"use client";

import { useEffect, useRef } from "react";
import Reveal from "@/components/marketing/Reveal";

const STATES = [
  { name: "ATTENTION", value: 0.72 },
  { name: "CONFIDENCE", value: 0.84 },
  { name: "CURIOSITY", value: 0.61 },
  { name: "CALM", value: 0.68 },
  { name: "GOAL FOCUS", value: 0.79 },
] as const;

/**
 * "Context has a state" — conceptual internal-state visualization.
 * Dark circular rings with large clean numbers. Explicitly framed as
 * human-inspired representation, not real emotion. Drift is gentle;
 * frozen under prefers-reduced-motion.
 */
export default function HomeInnerState() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const valEls = Array.from(section.querySelectorAll<HTMLElement>("[data-ring-val]"));
    const fillEls = Array.from(section.querySelectorAll<SVGCircleElement>("[data-ring-fill]"));
    const C = 2 * Math.PI * 30;

    const paint = (drift: number[]) => {
      valEls.forEach((v, i) => {
        const base = STATES[i].value + drift[i];
        const clamped = Math.max(0.05, Math.min(0.97, base));
        v.textContent = clamped.toFixed(2);
        const fill = fillEls[i];
        if (fill) fill.style.strokeDashoffset = String(C * (1 - clamped));
      });
    };

    paint([0, 0, 0, 0, 0]);
    if (reduced) return;

    let raf = 0;
    let inView = true;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = (now - t0) / 1000;
      if (inView && !document.hidden) {
        paint([
          0.03 * Math.sin(t * 0.11),
          0.025 * Math.sin(t * 0.09 + 1.4),
          0.03 * Math.sin(t * 0.13 + 2.8),
          0.025 * Math.sin(t * 0.08 + 4.1),
          0.03 * Math.sin(t * 0.1 + 5.3),
        ]);
      }
      raf = window.requestAnimationFrame(tick);
    };
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((es) => { inView = es.some((e) => e.isIntersecting); }, { threshold: 0.05 })
      : null;
    if (io && section) io.observe(section);
    raf = window.requestAnimationFrame(tick);
    return () => { window.cancelAnimationFrame(raf); io?.disconnect(); };
  }, []);

  return (
    <section ref={sectionRef} aria-labelledby="inner-state-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
              Internal state
            </p>
          </Reveal>
          <Reveal delay={100}>
            <h2
              id="inner-state-heading"
              className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
            >
              Not just what happened. How it matters.
            </h2>
          </Reveal>
          <Reveal delay={180}>
            <p className="mx-auto mt-6 max-w-xl leading-[1.75] text-[#cbd5e1]">
              Human cognition isn&rsquo;t only a record of events. Attention
              changes. Confidence changes. Goals compete. Mood influences
              interpretation. Experiences affect what happens next.
            </p>
          </Reveal>
        </div>

        <div
          className="mx-auto mt-14 grid max-w-5xl grid-cols-2 gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-3 md:mt-16 lg:grid-cols-5"
          role="img"
          aria-label="Conceptual illustration of human-inspired internal state: attention, confidence, curiosity, calm, and goal focus shown as quiet rings"
        >
          {STATES.map((s, i) => (
            <div key={s.name} className="salpa-ring-card bg-black p-6 text-center sm:p-7">
              <Reveal delay={i * 80}>
                <svg viewBox="0 0 72 72" className="salpa-ring mx-auto block size-[72px]" aria-hidden>
                  <circle cx="36" cy="36" r="30" fill="none" strokeWidth="2" className="salpa-ring-track" />
                  <circle
                    cx="36" cy="36" r="30" fill="none" strokeWidth="2"
                    className="salpa-ring-fill" data-ring-fill
                    strokeDasharray={2 * Math.PI * 30}
                    strokeDashoffset={2 * Math.PI * 30}
                  />
                  <circle cx="36" cy="6" r="2" fill="rgba(255,244,226,0.9)" />
                </svg>
                <p data-ring-val className="mt-4 text-2xl font-medium tabular-nums tracking-tight text-white">
                  {s.value.toFixed(2)}
                </p>
                <p className="mt-2 text-[10px] font-medium tracking-[0.22em] text-[#94a3b8]">{s.name}</p>
              </Reveal>
            </div>
          ))}
        </div>

        <Reveal>
          <p className="mx-auto mt-8 max-w-xl text-center text-xs leading-relaxed text-[#94a3b8]">
            Human-inspired internal state — a conceptual visualization, not a claim of real human feelings.
            Salpa does not claim consciousness, sentience, or human feeling.
          </p>
        </Reveal>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
