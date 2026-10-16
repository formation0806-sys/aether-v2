import Reveal from "@/components/marketing/Reveal";

/**
 * Section 3 — Persistent memory, rendered as layered strata.
 * Factual copy: extraction → durable storage → recall. Monochrome.
 */
const STRATA = [
  {
    title: "Kept from conversation",
    body: "Useful facts, preferences, and decisions are drawn from what you actually discuss — not entered by hand.",
  },
  {
    title: "Stored as durable memory",
    body: "Context is kept as long-lived memory in your workspace, available across sessions instead of trapped in one chat.",
  },
  {
    title: "Recalled when relevant",
    body: "When you return to a topic, Salpa brings back what matters — without you having to repeat yourself.",
  },
] as const;

export default function HomeMemory() {
  return (
    <section id="memory" aria-labelledby="memory-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <div className="grid items-start gap-14 md:grid-cols-2 md:gap-16">
          <div className="md:sticky md:top-24">
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
                Persistent memory · Foundation
              </p>
            </Reveal>
            <Reveal delay={100}>
              <h2
                id="memory-heading"
                className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
              >
                What matters, remembered.
              </h2>
            </Reveal>
            <Reveal delay={180}>
              <p className="mt-6 max-w-md leading-relaxed text-[#cbd5e1]">
                Salpa retains the facts, preferences, context, and goals that
                make your conversations useful — so understanding accumulates
                over time instead of evaporating between sessions.
              </p>
            </Reveal>
            <Reveal delay={240}>
              <p className="mt-6 max-w-md text-sm leading-relaxed text-[#94a3b8]">
                Memory gives continuity. Cognition gives that continuity
                direction.
              </p>
            </Reveal>
          </div>

          <ol className="space-y-4">
            {STRATA.map((s, i) => (
              <li key={s.title}>
                <Reveal delay={i * 110}>
                  <div className="salpa-stratum-sheen rounded-2xl border border-white/[0.08] bg-[#0A0A0A] p-6 sm:p-7">
                    <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[#94a3b8]">
                      {String(i + 1).padStart(2, "0")}
                    </p>
                    <h3 className="mt-3 text-lg font-medium tracking-tight text-white">
                      {s.title}
                    </h3>
                    <p className="mt-2 text-[15px] leading-relaxed text-[#cbd5e1]">
                      {s.body}
                    </p>
                  </div>
                </Reveal>
              </li>
            ))}
          </ol>
        </div>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
