import Reveal from "@/components/marketing/Reveal";
import { Eye, Database, MousePointer, Send } from "lucide-react";

const ICONS: Record<string, React.ElementType> = {
  Observe: Eye,
  Remember: Database,
  Reason: MousePointer,
  Respond: Send,
};

const STEPS = [
  { name: "Observe", icon: "Observe", body: "Understands your message and context." },
  { name: "Remember", icon: "Remember", body: "Looks up relevant memories and past conversations." },
  { name: "Reason", icon: "Reason", body: "Analyzes what matters right now." },
  { name: "Respond", icon: "Respond", body: "Gives you a helpful, personalized answer." },
] as const;

/**
 * How it works — a simple flow. A deeper understanding.
 * Four connected steps with thin connector lines and outlined icon circles.
 * Reflows to a vertical sequence on mobile.
 */
export default function HomeJourney() {
  return (
    <section
      id="how-it-works"
      aria-labelledby="journey-heading"
      className="scroll-mt-20"
    >
      <div className="mx-auto max-w-6xl px-5 py-28 sm:px-8 md:py-44">
        <div className="mx-auto max-w-3xl text-center">
          <Reveal>
            <p className="text-[11px] font-medium uppercase tracking-[0.22em] text-[#94a3b8]">
              HOW IT WORKS
            </p>
          </Reveal>
          <Reveal delay={100}>
            <h2
              id="journey-heading"
              className="mt-6 text-balance text-4xl font-semibold leading-[1.08] tracking-[-0.015em] text-white sm:text-5xl"
            >
              A simple flow. A deeper understanding.
            </h2>
          </Reveal>
          <Reveal delay={200}>
            <p className="mx-auto mt-6 max-w-xl leading-[1.75] text-[#cbd5e1]">
              Salpa observes, remembers, and reasons — so every response is
              informed by your history, your context, and your current goals.
            </p>
          </Reveal>
        </div>

        <Reveal delay={300}>
          <div className="mx-auto mt-16 max-w-3xl">
            <div className="salpa-steps-row">
              {STEPS.map((step, i) => {
                const Icon = ICONS[step.name];
                const isLast = i === STEPS.length - 1;
                return (
                  <div key={step.name} className="salpa-step">
                    <div className="salpa-step-node">
                      <Icon size={16} aria-hidden />
                    </div>
                    {!isLast && <div className="salpa-step-connector" aria-hidden />}
                    <div className="text-center">
                      <p className="text-[11px] font-medium tracking-[0.18em] text-[#94a3b8]">
                        {step.name}
                      </p>
                      <p className="mt-2 text-sm leading-relaxed text-[#cbd5e1]">
                        {step.body}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </Reveal>
      </div>
      <div aria-hidden className="mx-auto h-px max-w-6xl bg-white/[0.06]" />
    </section>
  );
}
