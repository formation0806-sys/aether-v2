import Reveal from "@/components/marketing/Reveal";

/**
 * Section 4 — Continuity as a product story (not a SaaS card grid).
 * Conversation 1 → remembered context → conversation 2 → deeper assistance.
 */
const STEPS = [
  {
    title: "You talk",
    body: "A normal conversation. Ask, decide, plan — Salpa keeps track of what was said and what it meant.",
  },
  {
    title: "Salpa remembers",
    body: "Context that matters is carried forward into your workspace's memory, tied to your ongoing work.",
  },
  {
    title: "You return",
    body: "Days later, you pick up where you left off. No recap needed — the thread is still there.",
  },
  {
    title: "It compounds",
    body: "Each session starts further along. Understanding deepens, follow-ups stay visible, work continues.",
  },
] as const;

export default function HomeContinuity() {
  return (
    <section id="continuity" aria-labelledby="continuity-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <Reveal>
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
            Continuity
          </p>
        </Reveal>
        <Reveal delay={100}>
          <h2
            id="continuity-heading"
            className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
          >
            Conversations that build on each other.
          </h2>
        </Reveal>
        <Reveal delay={180}>
          <p className="mt-6 max-w-xl leading-relaxed text-[#cbd5e1]">
            One thread of understanding, carried across every session — instead
            of a dozen disconnected chats.
          </p>
        </Reveal>

        <ol className="relative mt-14 md:mt-16">
          <div className="salpa-thread hidden md:block" aria-hidden />
          {STEPS.map((step, i) => (
            <li key={step.title} className="relative pb-10 last:pb-0 md:pl-12">
              <span
                aria-hidden
                className="absolute left-[2px] top-1.5 hidden size-[7px] rounded-full bg-white/70 md:block"
              />
              <Reveal delay={i * 110}>
                <div className="flex flex-col gap-2 border-t border-white/[0.07] pt-6 md:flex-row md:items-baseline md:gap-10">
                  <p className="shrink-0 text-[11px] font-medium uppercase tracking-[0.18em] text-[#94a3b8] md:w-28">
                    Step {i + 1}
                  </p>
                  <div>
                    <h3 className="text-xl font-medium tracking-tight text-white">
                      {step.title}
                    </h3>
                    <p className="mt-2 max-w-2xl leading-relaxed text-[#cbd5e1]">
                      {step.body}
                    </p>
                  </div>
                </div>
              </Reveal>
            </li>
          ))}
        </ol>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
