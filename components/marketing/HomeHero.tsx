import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Reveal from "@/components/marketing/Reveal";
import HomeCompanion from "@/components/marketing/HomeCompanion";

/**
 * Hero — clean and spacious.
 * Left-aligned text column (eyebrow, headline, supporting copy, Get started CTA)
 * with subtle atmospheric glow and horizon background elements behind it.
 * No bordered empty box beside the headline.
 */
export default function HomeHero() {
  return (
    <section
      id="hero"
      aria-labelledby="hero-heading"
      className="salpa-hero relative overflow-hidden scroll-mt-20"
    >
      {/* Atmospheric background elements behind the content */}
      <div aria-hidden className="salpa-hero-glow" />

      <div className="max-w-6xl px-5 pb-12 pt-20 sm:pt-40 sm:px-8 md:pb-24 md:pt-40">
        <div className="text-left">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
              YOUR PERSISTENT PERSONAL AI
            </p>
          </Reveal>

          <Reveal delay={120}>
            <h1
              id="hero-heading"
              className="mt-7 text-6xl font-semibold leading-[1.05] tracking-[-0.02em] text-white sm:text-7xl"
            >
              An AI that<br />
              remembers<br />
              you.
            </h1>
          </Reveal>

          <Reveal delay={220}>
            <p className="mt-6 max-w-xl text-pretty text-base leading-[1.5] line-clamp-3 text-[#cbd5e1] md:text-lg">
              Salpa remembers what matters, understands your context, and
              stays with you across sessions — so every conversation builds
              on the last instead of starting from zero.
            </p>
          </Reveal>

          <Reveal delay={300}>
            <div className="mt-6 flex flex-col sm:flex-row gap-4">
              <Link
                href="/signup"
                className="group inline-flex h-13 items-center gap-2 rounded-full bg-white px-8 py-3.5 text-[15px] font-medium text-black transition-all duration-200 hover:-translate-y-px hover:bg-[#EDEDED] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
              >
                Get started
              </Link>
            </div>
          </Reveal>
        </div>
      </div>

      <HomeCompanion />
    </section>
  );
}
