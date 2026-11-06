import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Reveal from "@/components/marketing/Reveal";
import HomeCompanionFigure from "@/components/marketing/HomeCompanionFigure";

/**
 * Section 5 — Closing (`#future`).
 *
 * One short, confident message and a single Get started CTA (/signup).
 *
 * The approved humanoid is reused SMALL on the opposite side as a visual
 * counterweight, with a gentle vertical bounce — the ONLY motion in this
 * section and the only bounce anywhere on the homepage. The bounce lives on
 * this component's unique `.salpa-future-figure` wrapper (see
 * `salpa-home.css`), so the hero companion is untouched by it.
 * `HomeCompanionFigure` is drawn directly (no `HomeCompanion` wrapper), so no
 * gaze tracker runs here, no behaviour is duplicated, and no accessible image
 * label is duplicated either — the wrapper is aria-hidden while the hero
 * keeps owning the single labelled instance of the companion.
 */
export default function HomeFuture() {
  return (
    <section
      id="future"
      aria-labelledby="future-heading"
      className="scroll-mt-20 bg-black"
    >
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-28">
        <div className="flex flex-col items-start gap-12 md:flex-row md:items-center md:justify-between">
          <div>
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
                THE FUTURE
              </p>
            </Reveal>
            <Reveal delay={100}>
              <h2
                id="future-heading"
                className="mt-6 text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-4xl"
              >
                A more continuous kind of AI.
              </h2>
            </Reveal>
            <Reveal delay={180}>
              <p className="mt-5 max-w-md leading-[1.8] text-[#cbd5e1]">
                Get started today and be part of what&rsquo;s next.
              </p>
            </Reveal>
            <Reveal delay={260}>
              <Link
                href="/signup"
                className="group mt-8 inline-flex h-13 items-center gap-2 rounded-full bg-white px-9 py-3.5 text-[15px] font-medium text-black transition-all duration-200 hover:-translate-y-px hover:bg-[#EDEDED] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Get started
                <ArrowRight
                  size={16}
                  aria-hidden
                  className="transition-transform duration-200 group-hover:translate-x-1"
                />
              </Link>
            </Reveal>
          </div>

          {/* Small bouncing counterweight — decorative, never labelled twice. */}
          <div
            aria-hidden="true"
            className="salpa-future-figure w-28 shrink-0 self-center sm:w-36 md:self-auto"
          >
            <HomeCompanionFigure trackInteractiveGaze />
          </div>
        </div>
      </div>
    </section>
  );
}