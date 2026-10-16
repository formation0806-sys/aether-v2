import Reveal from "@/components/marketing/Reveal";

const PILLARS = [
  { n: "01", name: "MEMORY", body: "What happened." },
  { n: "02", name: "CONTEXT", body: "Why it matters." },
  { n: "03", name: "ATTENTION", body: "What matters now." },
  { n: "04", name: "INTERNAL STATE", body: "How the current situation is represented." },
  { n: "05", name: "CONTINUITY", body: "What carries forward." },
] as const;

/* What we're building + active research notice. Honest, confident. */
export default function HomeBuilding() {
  return (
    <section aria-labelledby="building-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <Reveal>
          <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#94a3b8]">
            What we&rsquo;re building
          </p>
        </Reveal>
        <Reveal delay={100}>
          <h2 id="building-heading" className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl">
            Toward AI that develops continuity.
          </h2>
        </Reveal>
        <Reveal delay={180}>
          <p className="mt-6 max-w-2xl leading-relaxed text-[#cbd5e1]">
            Salpa is being built around a simple idea: an AI should not reset
            every time the conversation ends.
          </p>
        </Reveal>
        <div className="mt-14 grid gap-px overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.06] sm:grid-cols-2 lg:grid-cols-5">
          {PILLARS.map((p, i) => (
            <div key={p.name} className="salpa-pillar border border-transparent bg-black p-7">
              <Reveal delay={i * 80}>
                <p className="text-[11px] font-medium tracking-[0.18em] text-[#94a3b8]">{p.n}</p>
                <h3 className="mt-3 text-sm font-medium tracking-[0.12em] text-white">{p.name}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#cbd5e1]">{p.body}</p>
              </Reveal>
            </div>
          ))}
        </div>
        <Reveal delay={120}>
          <div className="mx-auto mt-14 max-w-2xl rounded-2xl border border-white/[0.08] bg-[#0A0A0A] p-6 text-center sm:p-8">
            <p className="text-sm font-medium text-white">Salpa is actively being developed.</p>
            <p className="mx-auto mt-3 max-w-xl text-sm leading-relaxed text-[#cbd5e1]">
              We&rsquo;re exploring how persistent memory, human-inspired cognition,
              and richer internal state representations can make AI more continuous
              and useful over time.
            </p>
          </div>
        </Reveal>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
