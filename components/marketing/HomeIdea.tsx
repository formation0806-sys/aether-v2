import Reveal from "@/components/marketing/Reveal";

/**
 * Section 2 — The problem / idea.
 * Editorial typography, zero clutter: ephemeral vs. persistent.
 */
export default function HomeIdea() {
  return (
    <section id="idea" aria-labelledby="idea-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <Reveal>
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
            The idea
          </p>
        </Reveal>
        <Reveal delay={100}>
          <h2
            id="idea-heading"
            className="mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
          >
            AI shouldn&rsquo;t start from zero every time you talk to it.
          </h2>
        </Reveal>
        <Reveal delay={180}>
          <div className="mt-10 grid max-w-4xl gap-8 md:grid-cols-2 md:gap-12">
            <div>
              <p className="text-sm font-medium text-[#94a3b8]">Most AI conversations</p>
              <p className="mt-3 leading-[1.75] text-[#cbd5e1]">
                Every session is temporary. You re-explain who you are, what
                you&rsquo;re working on, and what you&rsquo;ve already decided —
                then it all disappears when the chat ends.
              </p>
            </div>
            <div>
              <p className="text-sm font-medium text-white">Salpa is built around continuity</p>
              <p className="mt-3 leading-[1.75] text-[#cbd5e1]">
                Your context persists between conversations. Each session builds
                on the last, so the assistance compounds instead of resetting.
              </p>
            </div>
          </div>
        </Reveal>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
