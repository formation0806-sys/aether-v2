"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import { Check } from "lucide-react";
import Reveal from "@/components/marketing/Reveal";

/**
 * Section 5 — Product experience, described only with capabilities
 * that actually exist (chat / memory / tasks in one workspace).
 * Editorial composition: one large surface + small explanatory text.
 */
const CAPABILITIES = [
  "Natural, fluid conversations",
  "Access to your long-term memory",
  "Context-aware and personalized responses",
  "Built for privacy and control",
] as const;

// Mock navigation labels used only inside the illustrative workspace mockup.
// Not real routes — the mockup is a static illustration, not a live interface.
const MOCK_NAV = ["Home", "Memory", "Tasks", "Settings"] as const;

export default function HomeExperience() {
  const rememberedRef = useRef<HTMLDivElement>(null);

  // Subtle illumination: when the demo scrolls into view, the
  // "Remembered" panel gently lights once — pure presentation,
  // no backend behavior implied.
  useEffect(() => {
    const el = rememberedRef.current;
    if (!el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (typeof IntersectionObserver === "undefined") {
      el.classList.add("is-lit");
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            window.setTimeout(() => el.classList.add("is-lit"), 900);
            io.disconnect();
          }
        }
      },
      { threshold: 0.4 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <section id="experience" aria-labelledby="experience-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-36">
        <div className="grid items-start gap-14 md:grid-cols-[1fr_1.1fr] md:gap-16">
          <div className="text-left md:sticky md:top-24">
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
                THE PRODUCT
              </p>
            </Reveal>
            <Reveal delay={100}>
              <h2
                id="experience-heading"
                className="mt-6 max-w-xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
              >
                A personal AI that remembers and helps.
              </h2>
            </Reveal>
            <Reveal delay={200}>
              <p className="mt-7 max-w-xl leading-[1.75] text-[#cbd5e1] md:text-lg">
                Salpa keeps the full picture — so every conversation builds on
                the last. Context you&rsquo;ve already shared stays available,
                and follow-ups remain visible across sessions.
              </p>
            </Reveal>
            <Reveal delay={300}>
              <div className="mt-10 space-y-4">
                {CAPABILITIES.map((cap) => (
                  <div key={cap} className="flex items-start gap-3">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full border border-[#94a3b8]/60 text-[#94a3b8] shrink-0">
                      <Check size={14} strokeWidth={2} aria-hidden />
                    </div>
                    <p className="text-sm leading-relaxed text-[#cbd5e1]">{cap}</p>
                  </div>
                ))}
              </div>
            </Reveal>
            <Reveal delay={400}>
              <Link
                href="/signup"
                className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-[15px] font-medium text-black transition-all duration-200 hover:-translate-y-px hover:bg-[#EDEDED] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Get started
              </Link>
            </Reveal>
          </div>

          <div className="relative">
            <p className="mt-4 text-[11px] font-medium uppercase tracking-[0.2em] text-[#64748b]">
              Illustrative workspace mockup — not a live interface
            </p>
            <Reveal delay={220}>
              <div
                className="salpa-mock overflow-hidden"
                role="img"
                aria-label="Illustrative Salpa workspace: conversation area on the left, remembered-context panel on the right"
              >
                <div className="salpa-mock-glow" aria-hidden />
                {/* Window chrome */}
                <div className="absolute top-0 left-0 right-0 flex items-center gap-1.5 border-b border-white/[0.06] px-5 py-3.5 z-10 bg-black/80 backdrop-blur">
                  <span className="size-2.5 rounded-full bg-white/15" />
                  <span className="size-2.5 rounded-full bg-white/15" />
                  <span className="size-2.5 rounded-full bg-white/15" />
                  <span className="ml-3 text-xs text-[#64748b]">salpa — workspace</span>
                </div>
                <div className="grid gap-px bg-white/[0.06] md:grid-cols-[0.28fr_1.5fr_1fr] h-[520px]">
                  {/* Sidebar */}
                  <aside className="bg-[#05080D] border-r border-white/[0.06] p-5 sm:p-6 flex flex-col">
                    <div className="flex items-center gap-2.5 mb-10">
                      <span className="text-xs font-semibold tracking-[0.18em] text-white">SALPA</span>
                    </div>
                    <nav className="flex flex-col gap-1">
                      {MOCK_NAV.map((item) => (
                        <a
                          key={item}
                          className="flex items-center gap-2.5 px-3 py-2.5 text-xs text-[#94a3b8] rounded-md transition-colors hover:bg-white/[0.04] hover:text-white"
                          aria-hidden
                        >
                          <span className="size-3.5 rounded-full border border-white/[0.12]" aria-hidden />
                          {item}
                        </a>
                      ))}
                    </nav>
                  </aside>
                  {/* Conversation pane */}
                  <div className="bg-[#0a0a0a] p-6 sm:p-8 overflow-y-auto">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#64748b]">
                      Conversation
                    </p>
                    <div className="mt-5 space-y-4 text-[15px] leading-relaxed">
                      <p className="max-w-sm rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-[#d4d4d4]">
                        I&rsquo;m narrowing the launch to two onboarding flows — remind
                        me which one we picked?
                      </p>
                      <p className="max-w-sm rounded-2xl rounded-br-md bg-white px-4 py-3 text-black">
                        The shorter flow. You chose it last week because signup
                        drop-off was the bigger risk.
                      </p>
                      <p className="max-w-sm rounded-2xl rounded-bl-md border border-white/[0.07] bg-white/[0.03] px-4 py-3 text-[#d4d4d4]">
                        Right — and keep following up on the pricing draft.
                      </p>
                    </div>
                    <div className="mt-8 pt-4 border-t border-white/[0.06] flex items-center gap-3">
                      <span className="size-6 rounded-full bg-[#94a3b8]/20 flex items-center justify-center text-[#94a3b8] text-xs">S</span>
                      <div className="flex-1">
                        <p className="text-xs text-[#94a3b8]">Type a message&hellip;</p>
                      </div>
                    </div>
                  </div>
                  {/* Remembered + tasks pane */}
                  <div ref={rememberedRef} className="salpa-remembered bg-black p-6 sm:p-8 overflow-y-auto">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#64748b]">
                      Remembered
                    </p>
                    <ul className="mt-5 space-y-3 text-sm leading-relaxed text-[#94a3b8]">
                      <li className="rounded-xl border border-white/[0.07] px-4 py-3">
                        Prefers the shorter onboarding flow
                      </li>
                      <li className="rounded-xl border border-white/[0.07] px-4 py-3">
                        Launch priority: signup conversion
                      </li>
                      <li className="rounded-xl border border-white/[0.07] px-4 py-3">
                        Open follow-up: pricing draft
                      </li>
                    </ul>
                  </div>
                </div>
              </div>
            </Reveal>
          </div>

        </div>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
