import Link from "next/link";
import { ArrowRight } from "lucide-react";
import Reveal from "@/components/marketing/Reveal";

/**
 * Section 7 — Final CTA. Cinematic but minimal: black, white type,
 * one primary action. No circular mark by design.
 */
export default function HomeFinalCta() {
  return (
    <section aria-labelledby="final-heading">
      <div className="mx-auto flex max-w-6xl flex-col items-center px-5 py-32 text-center sm:px-8 md:py-52">
        <Reveal>
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
            Begin
          </p>
        </Reveal>
        <Reveal delay={120}>
          <h2
            id="final-heading"
            className="mx-auto mt-6 max-w-3xl text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.02em] text-white sm:text-6xl"
          >
            An AI that remembers what matters.
          </h2>
        </Reveal>
        <Reveal delay={220}>
          <p className="mx-auto mt-6 max-w-md leading-[1.75] text-[#cbd5e1]">
            Create your workspace. Every conversation from here builds on the last.
          </p>
        </Reveal>
        <Reveal delay={300}>
          <Link
            href="/signup"
            className="group mt-10 inline-flex items-center gap-2 rounded-full bg-white px-8 py-3.5 text-[15px] font-medium text-black transition-all duration-200 hover:-translate-y-px hover:bg-[#EDEDED] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-white"
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
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
