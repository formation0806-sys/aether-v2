import Link from "next/link";
import Reveal from "@/components/marketing/Reveal";
import { Database, Globe, GitBranch, Sparkles } from "lucide-react";

const ICONS: Record<string, React.ElementType> = {
  Memory: Database,
  Context: Globe,
  Continuity: GitBranch,
  Personalization: Sparkles,
};

/**
 * Why SALPA — continuity, not just memory.
 * Split layout: explanation left, four refined feature blocks right.
 * "Explore how it works" links to the How it works section.
 */
const PRINCIPLES = [
  {
    title: "Memory",
    body: "Remembers your conversations, preferences, and important details.",
    icon: "Memory",
  },
  {
    title: "Context",
    body: "Understands what matters right now, not just what you say.",
    icon: "Context",
  },
  {
    title: "Continuity",
    body: "Stays with you across sessions, days, and changing situations.",
    icon: "Continuity",
  },
  {
    title: "Personalization",
    body: "Adapts to your goals, habits, and evolving needs.",
    icon: "Personalization",
  },
] as const;

export default function HomePrinciples() {
  return (
    <section id="why-salpa" aria-labelledby="principles-heading" className="scroll-mt-20">
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <div className="grid items-start gap-14 md:grid-cols-[1fr_1fr] md:gap-16">
          <div className="text-left md:sticky md:top-24">
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
                WHY SALPA
              </p>
            </Reveal>
            <Reveal delay={100}>
              <h2
                id="principles-heading"
                className="mt-6 max-w-xl text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
              >
                More than memory. It&rsquo;s continuity.
              </h2>
            </Reveal>
            <Reveal delay={200}>
              <p className="mt-7 max-w-xl leading-[1.75] text-[#cbd5e1] md:text-lg">
                Most conversations reset the moment they end. Salpa keeps the
                thread — context, preferences, and decisions carry forward so
                each session builds on the last instead of starting from zero.
              </p>
            </Reveal>
            <Reveal delay={300}>
              <Link
                href="#how-it-works"
                className="inline-flex items-center gap-2 text-[13px] font-medium text-[#cbd5e1] transition-colors hover:text-white focus-visible:underline"
              >
                Explore how it works
                <span className="text-[10px]">→</span>
              </Link>
            </Reveal>
          </div>

          <div className="grid gap-6">
            {PRINCIPLES.map((p, i) => {
              const Comp = ICONS[p.icon];
              return (
                <Reveal key={p.title} delay={i * 90} className="contents">
                  <div className="salpa-feature p-6">
                    <div className="salpa-feature-icon">
                      <Comp size={18} aria-hidden />
                    </div>
                    <div className="mt-6">
                      <h3 className="text-lg font-medium tracking-tight text-white">
                        {p.title}
                      </h3>
                      <p className="mt-3 text-[15px] leading-relaxed text-[#cbd5e1]">
                        {p.body}
                      </p>
                    </div>
                  </div>
                </Reveal>
              );
            })}
          </div>
        </div>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
