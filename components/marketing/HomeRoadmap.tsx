import { Fragment } from "react";
import { ArrowRight } from "lucide-react";
import Reveal from "@/components/marketing/Reveal";

/**
 * Section 4 — Roadmap (`#how-it-works`).
 *
 * Three honest stages, horizontal on desktop (thin arrow connectors) and
 * vertical on mobile (thin line connectors). The status labels are exact and
 * verified against project documentation:
 *
 *   01 Memory               — Live
 *       Persistent memory, retrieval and identity injection are exercised
 *       through the real chat path (docs/CURRENT_STATE.md).
 *   02 Connected cognition  — Exploring
 *       docs/COGNITION_DESIGN.md: contracts and deterministic primitives only,
 *       ENABLE_COGNITION default OFF, "no cognition runtime on any live path".
 *   03 Continuous learning  — Long-term direction
 *       docs/CONTINUAL_LEARNING_DESIGN.md: foundation only, flag OFF,
 *       "imported by no production file".
 *
 * No percentages, no dates, no progress bars, no autonomous-learning promises.
 * A footnote makes the live-vs-research distinction unmistakable.
 */
const STAGES = [
  {
    num: "01",
    title: "Memory",
    status: "Live",
    copy: "Core memory, context and personalization in place.",
  },
  {
    num: "02",
    title: "Connected cognition",
    status: "Exploring",
    copy: "Linking memory, attention, goals, reflection and learning.",
  },
  {
    num: "03",
    title: "Continuous learning",
    status: "Long-term direction",
    copy: "Adapting over time, with your input and real-world context.",
  },
] as const;

export default function HomeRoadmap() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="roadmap-heading"
      className="scroll-mt-20 bg-black"
    >
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-28">
        <Reveal>
          <h2
            id="roadmap-heading"
            className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]"
          >
            OUR ROADMAP
          </h2>
        </Reveal>

        <div className="mt-10 flex flex-col md:flex-row md:items-start">
          {STAGES.map((s, i) => (
            <Fragment key={s.num}>
              <article className="flex-1">
                <div className="flex items-center gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.18] text-[11px] font-semibold tracking-[0.08em] text-white/75">
                    {s.num}
                  </span>
                  <h3 className="text-base font-semibold text-white sm:text-lg">
                    {s.title}
                  </h3>
                </div>
                <p className="mt-4 max-w-[30ch] text-sm leading-relaxed text-[#94a3b8]">
                  {s.copy}
                </p>
                <span
                  className={
                    s.status === "Live"
                      ? "mt-5 inline-flex items-center rounded-full border border-white/[0.24] bg-white/[0.06] px-3 py-1 text-[12px] font-medium text-white"
                      : "mt-5 inline-flex items-center rounded-full border border-white/[0.12] bg-transparent px-3 py-1 text-[12px] font-medium text-[#94a3b8]"
                  }
                >
                  {s.status}
                </span>
              </article>

              {i < STAGES.length - 1 && (
                <>
                  {/* Desktop: thin arrow connector between stages. */}
                  {/* Mobile: thin vertical connector between stages. */}
                  <div aria-hidden className="md:hidden">
                    <ArrowRight size={16} className="text-white/25" />
                  </div>
                </>
              )}
            </Fragment>
          ))}
        </div>

        <Reveal delay={120}>
          <p className="mt-12 max-w-2xl text-[13px] leading-relaxed text-[#8a847a]">
            Stage 01 is live in Salpa today. Stages 02 and 03 describe the
            direction we are exploring — research, not shipped features.
          </p>
        </Reveal>
      </div>
    </section>
  );
}