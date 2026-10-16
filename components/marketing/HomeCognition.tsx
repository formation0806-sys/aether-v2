import Reveal from "@/components/marketing/Reveal";

/**
 * Human-inspired cognition — editorial text column.
 * Honest research framing: no consciousness, sentience, or real emotion.
 */
export default function HomeCognition() {
  return (
    <section aria-labelledby="cognition-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <div className="gap-14">
          <div>
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
                Human-inspired cognition
              </p>
            </Reveal>
            <Reveal delay={100}>
              <h2
                id="cognition-heading"
                className="mt-6 max-w-md text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
              >
                AI should remember more than facts.
              </h2>
            </Reveal>
            <Reveal delay={180}>
              <p className="mt-6 max-w-md leading-[1.75] text-[#cbd5e1] md:text-lg">
                We&rsquo;re exploring architectures that give persistent AI richer
                internal context — including attention, goals, mood, confidence,
                reflection, and other human-inspired cognitive signals.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <p className="mt-6 max-w-md text-sm leading-relaxed text-[#94a3b8]">
                Toward AI that doesn&rsquo;t just remember — it understands context.
                Researching human-inspired cognition for persistent AI.
              </p>
            </Reveal>
          </div>
        </div>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
