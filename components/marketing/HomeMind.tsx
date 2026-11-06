import Reveal from "@/components/marketing/Reveal";

/**
 * Section 3 — The mind (`#mind`).
 *
 * The approved realistic 3D brain render on pure black. Static image — no
 * animation loop, no dependency, no gradient, no heavy glow.
 *
 * The illustration is explicitly conceptual: its accessible label says it is
 * a metaphor and not a literal human brain, and nothing in this section claims
 * consciousness, sentience, emotions, or human-equivalent intelligence
 * (pinned by tests/unit/components/home-cinematic.test.ts).
 */

/** Approved 3D brain render served from `public/brain/`. Rendered inside the
 * existing SVG so the viewBox, accessible role/label and image geometry stay
 * exactly as they were. */
const BRAIN_IMAGE_SRC = "/brain/salpa-brain-recovered.png";

/** The same five concepts, explained in plain language beside the figure. */
const CONCEPTS = [
  { label: "MEMORY", desc: "What Salpa keeps from your conversations." },
  { label: "ATTENTION", desc: "What matters most in the moment." },
  { label: "GOALS", desc: "What you are working toward over time." },
  { label: "REFLECTION", desc: "Reviewing what happened and what to adjust." },
  { label: "LEARNING", desc: "Improving with your feedback and context." },
] as const;

/**
 * The illustration's accessible label: two connected hemispheres with
 * simplified folds — a conceptual metaphor, not a literal human brain,
 * not a biological organ, and not a depiction of a live internal system.
 */
const ILLUSTRATION_LABEL =
  "Conceptual line illustration of two connected cerebral hemispheres with simplified winding folds — a metaphor for Salpa's architecture, not a literal human brain, not a biological organ, and not a depiction of a live internal system.";

export default function HomeMind() {
  return (
    <section
      id="mind"
      aria-labelledby="mind-heading"
      className="scroll-mt-20 bg-black"
    >
      <div className="mx-auto max-w-6xl px-5 py-24 sm:px-8 md:py-32">
        <div className="grid items-center gap-14 md:grid-cols-2 md:gap-16">
          {/* Copy + concept list — left. */}
          <div>
            <Reveal>
              <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-[#94a3b8]">
                THE MIND
              </p>
            </Reveal>
            <Reveal delay={100}>
              <h2
                id="mind-heading"
                className="mt-6 text-balance text-3xl font-semibold leading-[1.1] tracking-[-0.02em] text-white sm:text-4xl"
              >
                Beyond memory:
                <span className="block">a mind in progress.</span>
              </h2>
            </Reveal>
            <Reveal delay={180}>
              <p className="mt-6 max-w-md leading-[1.8] text-[#cbd5e1]">
                We&rsquo;re exploring human-inspired cognitive architecture —
                not claiming a human mind, but building systems that can
                connect memory, attention, goals, reflection and learning.
              </p>
            </Reveal>
            <Reveal delay={260}>
              <ul className="mt-8 max-w-md">
                {CONCEPTS.map((c) => (
                  <li
                    key={c.label}
                    className="flex items-baseline gap-4 border-t border-white/[0.04] py-3 first:border-t-0"
                  >
                    <span className="w-[6.5rem] shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">
                      {c.label}
                    </span>
                    <span className="text-sm leading-relaxed text-[#94a3b8]">
                      {c.desc}
                    </span>
                  </li>
                ))}
              </ul>
            </Reveal>
          </div>

          {/* Illustration — right. Recovered brain image. */}
          <Reveal delay={140}>
            <div className="salpa-mind-figure flex items-center justify-center">
              <img
                src={BRAIN_IMAGE_SRC}
                alt={ILLUSTRATION_LABEL}
                role="img"
                aria-label={ILLUSTRATION_LABEL}
                className="block h-auto w-full object-contain md:max-w-[650px] md:h-[420px]"
                style={{ objectFit: "contain", transform: "scale(1.5)", transformOrigin: "center" }}
              />
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}