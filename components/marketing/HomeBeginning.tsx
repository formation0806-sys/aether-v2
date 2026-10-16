"use client";

import { useEffect, useRef } from "react";
import Reveal from "@/components/marketing/Reveal";

const STAGES = [
  { name: "MEMORY", body: "What happened is kept — the foundation everything else builds on." },
  { name: "CONTEXT", body: "What it means — the situation around the fact." },
  { name: "ATTENTION", body: "What matters now — what to focus on in this moment." },
  { name: "GOALS", body: "What we're working toward — the direction underneath the work." },
  { name: "REFLECTION", body: "What should change — learning from what happened." },
  { name: "CONTINUITY", body: "What carries forward — so nothing resets." },
] as const;

/**
 * "Memory is only the beginning" — horizontal cognitive chain on desktop,
 * calm vertical progression on mobile. Nodes illuminate one by one.
 */
export default function HomeBeginning() {
  const listRef = useRef<HTMLOListElement>(null);

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const rows = Array.from(list.querySelectorAll(".salpa-chain-item"));
    if (typeof IntersectionObserver === "undefined") {
      rows.forEach((r) => r.classList.add("is-active"));
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            // Stagger: activate predecessors so light travels left → right.
            const idx = rows.indexOf(e.target as Element);
            rows.forEach((r, i) => {
              if (i <= idx) {
                window.setTimeout(() => r.classList.add("is-active"), (idx - i) * 60);
              }
            });
            (e.target as Element).classList.add("is-active");
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.5 }
    );
    rows.forEach((r) => io.observe(r));
    return () => io.disconnect();
  }, []);

  return (
    <section aria-labelledby="beginning-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
              Beyond remembering
            </p>
          </Reveal>
          <Reveal delay={100}>
            <h2
              id="beginning-heading"
              className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
            >
              Memory is only the beginning.
            </h2>
          </Reveal>
          <Reveal delay={180}>
            <p className="mx-auto mt-6 max-w-xl leading-[1.75] text-[#cbd5e1]">
              Remembering what happened is the foundation. Understanding what
              matters requires context, attention, goals, reflection, and
              continuity.
            </p>
          </Reveal>
        </div>

        <ol ref={listRef} className="salpa-chain mx-auto mt-16 max-w-5xl md:mt-20" aria-label="From memory to continuity">
          <div className="flex flex-col md:flex-row md:items-start">
            {STAGES.map((s, i) => (
              <li key={s.name} className="salpa-chain-item flex flex-1 items-start gap-5 md:flex-col md:items-center md:gap-0 md:text-center">
                <Reveal delay={i * 70} className="contents">
                  <span aria-hidden className="salpa-chain-node mt-1 md:mx-auto md:mt-0" />
                  <div className="salpa-chain-label flex-1 pb-9 md:flex-none md:px-3 md:pt-5 md:pb-0">
                    <p className="text-[12px] font-medium tracking-[0.2em] text-white">
                      <span className="mr-2 text-[10px] text-[#94a3b8]">{String(i + 1).padStart(2, "0")}</span>
                      {s.name}
                    </p>
                    <p className="mt-2 text-sm leading-relaxed text-[#cbd5e0]">{s.body}</p>
                  </div>
                </Reveal>
                {i < STAGES.length - 1 && (
                  <span aria-hidden className="salpa-chain-link mt-[38px] hidden w-full md:block" />
                )}
              </li>
            ))}
          </div>
        </ol>

        <Reveal>
          <p className="mx-auto mt-6 max-w-xl text-center text-sm leading-relaxed text-[#707070]">
            Building AI with memory, cognition, and continuity.
          </p>
        </Reveal>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
