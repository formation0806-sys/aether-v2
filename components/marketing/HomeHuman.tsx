import Reveal from "@/components/marketing/Reveal";

/* Human presence — one tasteful, abstract panel.
   Fully self-generated (layered monochrome gradients suggesting a gaze
   in darkness). No stock photo hotlinked, no licensing risk, no clichés. */
export default function HomeHuman() {
  return (
    <section aria-labelledby="human-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <div className="grid items-center gap-12 md:grid-cols-2 md:gap-16">
          <Reveal>
            <div
              className="salpa-human-frame relative aspect-[4/5] overflow-hidden rounded-2xl border border-white/[0.08] bg-black"
              role="img"
              aria-label="Abstract dark composition suggesting a human gaze emerging from shadow — there is a person on the other side of the AI"
            >
              <div aria-hidden className="absolute inset-0" style={{ background: "radial-gradient(38% 22% at 50% 42%, rgba(255,244,228,0.16), transparent 70%), radial-gradient(70% 50% at 50% 110%, rgba(120,125,145,0.10), transparent 70%), radial-gradient(90% 90% at 50% 0%, rgba(255,255,255,0.04), transparent 60%), #060606" }} />
              <div aria-hidden className="absolute left-1/2 top-[42%] h-px w-2/3 -translate-x-1/2 bg-white/[0.14]" style={{ filter: "blur(6px)" }} />
              <div aria-hidden className="absolute inset-x-0 bottom-0 h-2/3" style={{ background: "linear-gradient(to top, rgba(0,0,0,0.85), transparent)" }} />
              <p className="absolute inset-x-0 bottom-0 p-6 text-center text-[11px] font-medium uppercase tracking-[0.28em] text-white/50">
                There is a person here
              </p>
            </div>
          </Reveal>
          <div>
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#94a3b8]">
                The human side
              </p>
            </Reveal>
            <Reveal delay={100}>
              <h2 id="human-heading" className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl">
                There is a person on the other side of the AI.
              </h2>
            </Reveal>
            <Reveal delay={180}>
              <p className="mt-6 max-w-md leading-[1.75] text-[#cbd5e0]">
                Attention, goals, and mood aren&rsquo;t abstractions — they belong
                to someone with work that matters. Salpa is being built to hold
                that context with care, across every conversation.
              </p>
            </Reveal>
          </div>
        </div>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
