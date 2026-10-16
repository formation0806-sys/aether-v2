import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Reveal from "@/components/marketing/Reveal";

/**
 * Section — Your journey with SALPA (closing).
 * Left: headline, copy, and a distant illuminated horizon built with CSS.
 * Right: the closing message and a working Get started CTA.
 * The horizon is atmospheric, low contrast, and stays behind the content so it
 * never reduces readability. No video, WebGL, or canvas.
 */
export default function HomeClosing() {
  return (
    <section
      id="journey"
      aria-labelledby="journey-heading"
      className="scroll-mt-20 relative"
    >
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <div className="grid items-center gap-16 md:grid-cols-2 md:gap-24">
          {/* Headline + copy side, with the horizon visual behind it. */}
          <div className="text-left relative">
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
                YOUR JOURNEY WITH SALPA
              </p>
            </Reveal>
            <Reveal delay={100}>
              <h2
                id="journey-heading"
                className="mt-6 max-w-md text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
              >
                A companion that gets better with time.
              </h2>
            </Reveal>
            <Reveal delay={200}>
              <p className="mt-7 max-w-md leading-[1.75] text-[#cbd5e1] md:text-lg">
                The more you talk, the more Salpa can learn from the context you
                choose to preserve. Because your story isn&rsquo;t just a
                conversation &mdash; it&rsquo;s a journey.
              </p>
            </Reveal>

            <div className="mt-12 relative h-[260px] rounded-2xl overflow-hidden border border-white/[0.08] bg-[#05080D]">
              <div aria-hidden className="salpa-journey-horizon" />
              <div aria-hidden className="salpa-journey-glow" />
            </div>
          </div>

          {/* Closing message + CTA on the opposite side. */}
          <div className="text-left">
            <Reveal delay={300}>
              <h3
                className="mt-6 max-w-md text-3xl font-semibold leading-[1.12] tracking-tight text-white sm:text-4xl"
              >
                Your memories.<br />
                Your goals.<br />
                Your AI companion.
              </h3>
            </Reveal>
            <Reveal delay={400}>
              <Link
                href="/signup"
                className="mt-10 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-[15px] font-medium text-black transition-all duration-200 hover:-translate-y-px hover:bg-[#EDEDED] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
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
        </div>
      </div>
    </section>
  );
}
