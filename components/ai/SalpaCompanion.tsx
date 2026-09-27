type SalpaCompanionProps = {
  /**
   * Visual variant. "minimal" is the default and is the only variant rendered
   * by the current chat experience; "holographic" and "shadow" exist as
   * approved visual states and are intentionally not wired to any
   * application state yet.
   */
  variant?: "minimal" | "holographic" | "shadow";
  /**
   * Tailwind classes supplied by the caller (size and colour tokens). The
   * companion is monochrome and inherits the caller's `currentColor`, so it
   * always matches the surrounding Salpa surface.
   */
  className?: string;
};

/**
 * The pangolin, drawn in profile facing right on a 100x62 grid that is fitted
 * closely to the artwork, so the animal fills roughly 90% of the box instead
 * of floating in empty space.
 *
 * Anatomy, front to back: a small pointed head and snout, a deep domed and
 * arched back, a heavy tail tapering to a point, and two short clawed feet.
 * Four curved plates across the back read as the overlapping armour that
 * makes a pangolin recognisable, and a filled eye completes the read.
 *
 * The head is a separate group that deliberately OVERLAPS the body across
 * x 67..73. That overlap is wider than the gap a few degrees of neck rotation
 * can open, so the animal turns its head without the outline ever splitting.
 *
 * Overall extent: x 5..96, y 7..65.
 */
const BODY_PATH =
  "M 30 26 C 34 14 48 8 60 10 C 66 11 71 16 74 23 " +
  "C 76 30 74 38 69 45 C 62 54 50 58 41 54 C 33 50 29 39 30 26 Z";

/** Small head with a pointed snout; overlaps the body across x 67..73. */
const HEAD_PATH =
  "M 66 24 C 68 16 75 11 83 12 C 89 13 94 18 96 24 " +
  "C 95 30 90 35 84 37 C 77 38 70 35 68 30 C 67 28 66 26 66 24 Z";

/** Heavy tapering tail sweeping down and left, tucked behind the body. */
const TAIL_PATH =
  "M 33 27 C 25 31 17 40 11 51 C 8 56 6 61 5 64 " +
  "C 7 63 10 59 13 54 C 17 48 21 42 25 37 C 28 33 31 30 33 27 Z";

/** Four curved plates across the back: the pangolin's overlapping armour. */
const SCALE_BANDS = [
  "M 70 16 C 68 26 68 36 70 44",
  "M 58 12 C 55 23 55 35 57 46",
  "M 46 12 C 43 23 43 35 45 47",
  "M 36 18 C 33 28 33 38 35 47",
];

/** Two rings banding the tapering tail. */
const TAIL_BANDS = [
  "M 18 41 C 20 46 20 50 19 54",
  "M 27 33 C 29 37 29 41 28 45",
];

/** Two short feet under the belly. */
const LEGS = [
  "M 66 52 C 66 56 66 60 65 63",
  "M 42 53 C 42 57 42 61 41 64",
];

/** The eye: a single filled dot, the detail that makes it read as an animal. */
const EYE = { cx: 82, cy: 26, r: 1.8 };

/**
 * Shared stroke geometry so all three variants line up exactly.
 *
 * `strokeWidth` is deliberately NOT part of this spread: every variant sets
 * it explicitly so no width is ever silently overridden by a default.
 */
const strokeProps = {
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  fill: "none",
};

/** Outline weight for the body, and the lighter weight for interior detail. */
const BODY_WIDTH = 1.9;
const DETAIL_WIDTH = 1.4;

/**
 * SalpaCompanion - the Salpa pangolin companion.
 *
 * Purely presentational and decorative:
 *   - no hooks, no application state, no data fetching, no effects;
 *   - inline SVG only, no external asset and no animation dependency;
 *   - `aria-hidden`, because the companion conveys no information that the
 *     surrounding text does not already carry.
 *
 * Design language: monochrome, inheriting `currentColor`, stroke-only, with
 * no saturated colour and no cartoon detail, so it sits naturally inside the
 * existing black Salpa surfaces (`#F5F5F5` / `#A0A0A0` / `#707070` on
 * `#000000` / `#0A0A0A`).
 *
 * Motion: extremely subtle, and only expressed through Tailwind's
 * `motion-safe:` variant, which suppresses animation entirely when the user
 * has asked for reduced motion. No stylesheet is modified and no JavaScript
 * runs to honour that preference.
 *
 * The component renders one glyph at the caller's requested size and adds no
 * layout box of its own, so it can be dropped into an existing identity slot
 * without shifting alignment or spacing.
 */
export default function SalpaCompanion({
  variant = "minimal",
  className,
}: SalpaCompanionProps) {
  return (
    <svg
      viewBox="0 4 100 62"
      fill="none"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-salpa-companion={variant}
    >
      {variant === "holographic" ? (
        <HolographicPangolin />
      ) : variant === "shadow" ? (
        <ShadowPangolin />
      ) : (
        <MinimalPangolin />
      )}
    </svg>
  );
}

/**
 * Variant B - minimal 2D pangolin.
 *
 * The primary Salpa companion identity: clean, premium, monochrome. Used for
 * normal chat, listening, responding and welcome.
 *
 * Five independently animated groups make the companion read as a living
 * animal rather than a static glyph. The body breathes, the head turns about
 * the neck, the tail sways about the tail root, the scale plates shift, and
 * the eye blinks once per cycle. All five classes are defined in
 * `app/globals.css` and are gated behind `prefers-reduced-motion`.
 */
function MinimalPangolin() {
  return (
    <g
      className="salpa-body"
      stroke="currentColor"
      strokeOpacity={0.92}
      {...strokeProps}
    >
      {/* Tail: sways about the tail root. */}
      <g className="salpa-tail">
        <path d={TAIL_PATH} strokeWidth={BODY_WIDTH} />
        {TAIL_BANDS.map((d) => (
          <path key={d} d={d} strokeOpacity={0.5} strokeWidth={DETAIL_WIDTH} />
        ))}
      </g>

      {/* Body: rises and falls with the breathing motion. */}
      <path d={BODY_PATH} strokeWidth={BODY_WIDTH} />
      {LEGS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.6} strokeWidth={DETAIL_WIDTH} />
      ))}

      {/* Head: turns about the neck, inside the body's overlap. */}
      <g className="salpa-head">
        <path d={HEAD_PATH} strokeWidth={BODY_WIDTH} />
      </g>

      {/* Eye: blinks on its own long cycle. */}
      <circle
        className="salpa-eye"
        cx={EYE.cx}
        cy={EYE.cy}
        r={EYE.r}
        fill="currentColor"
        stroke="none"
      />

      {/* Scales: the armour plates shift gently. */}
      <g className="salpa-scales">
        {SCALE_BANDS.map((d) => (
          <path key={d} d={d} strokeOpacity={0.6} strokeWidth={DETAIL_WIDTH} />
        ))}
      </g>
    </g>
  );
}

/**
 * Variant F - holographic pangolin.
 *
 * Reserved for when Salpa is genuinely active (thinking, long-running work).
 * It shares the exact same grouped anatomy as the minimal variant and adds a
 * faint same-hue sheen plus a soft edge glow, both derived from
 * `currentColor`.
 *
 * The `salpa-active` class shortens every animation duration, so while working
 * the animal breathes and sways noticeably faster than at rest. There is no
 * rainbow, no chromatic aberration and no rapid motion, so it stays premium
 * rather than gaming-like.
 */
function HolographicPangolin() {
  return (
    <g className="salpa-active salpa-body" stroke="currentColor" strokeOpacity={0.95}>
      <defs>
        <linearGradient id="salpa-holo-sheen" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.45} />
          <stop offset="45%" stopColor="currentColor" stopOpacity={0.95} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.5} />
        </linearGradient>
        <filter id="salpa-holo-glow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="0.8" />
        </filter>
      </defs>

      {/* Soft same-hue halo, drawn behind the animal. */}
      <g filter="url(#salpa-holo-glow)" {...strokeProps} strokeWidth={3}>
        <path d={TAIL_PATH} strokeOpacity={0.16} />
        <path d={BODY_PATH} strokeOpacity={0.22} />
        <path d={HEAD_PATH} strokeOpacity={0.22} />
      </g>

      <g className="salpa-tail" {...strokeProps}>
        <path d={TAIL_PATH} strokeWidth={BODY_WIDTH} />
        {TAIL_BANDS.map((d) => (
          <path key={d} d={d} strokeOpacity={0.5} strokeWidth={DETAIL_WIDTH} />
        ))}
      </g>

      {/* Sheened body. */}
      <path
        d={BODY_PATH}
        stroke="url(#salpa-holo-sheen)"
        strokeWidth={BODY_WIDTH + 0.15}
        {...strokeProps}
      />
      {LEGS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.55} strokeWidth={DETAIL_WIDTH} {...strokeProps} />
      ))}

      <g className="salpa-head" {...strokeProps}>
        <path
          d={HEAD_PATH}
          stroke="url(#salpa-holo-sheen)"
          strokeWidth={BODY_WIDTH + 0.15}
        />
        <circle
          className="salpa-eye"
          cx={EYE.cx}
          cy={EYE.cy}
          r={EYE.r}
          fill="currentColor"
          stroke="none"
        />
      </g>

      <g className="salpa-scales">
        {SCALE_BANDS.map((d) => (
          <path key={d} d={d} strokeOpacity={0.65} strokeWidth={DETAIL_WIDTH} {...strokeProps} />
        ))}
      </g>

      {/* A restrained band of light travelling across the armour. */}
      <g className="salpa-sweep" {...strokeProps} strokeWidth={DETAIL_WIDTH + 0.4}>
        {SCALE_BANDS.map((d) => (
          <path key={d} d={d} stroke="url(#salpa-holo-sheen)" strokeOpacity={0.9} />
        ))}
      </g>
    </g>
  );
}

/**
 * Variant G - shadow pangolin.
 *
 * Reserved for the quiet, idle state: a very dark silhouette that recedes
 * into the black surface. The `salpa-resting` class stretches every animation
 * to roughly twice the length of the normal variant, so the animal still
 * breathes but only barely registers - appropriate for a resting creature.
 *
 * Not wired to any application state in the current chat experience.
 */
function ShadowPangolin() {
  return (
    <g
      className="salpa-resting salpa-body"
      stroke="currentColor"
    >
      <g className="salpa-tail" {...strokeProps}>
        <path d={TAIL_PATH} strokeOpacity={0.34} strokeWidth={BODY_WIDTH} />
        {TAIL_BANDS.map((d) => (
          <path key={d} d={d} strokeOpacity={0.2} strokeWidth={DETAIL_WIDTH} />
        ))}
      </g>

      <path d={BODY_PATH} strokeOpacity={0.38} strokeWidth={BODY_WIDTH} {...strokeProps} />
      {LEGS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.22} strokeWidth={DETAIL_WIDTH} {...strokeProps} />
      ))}

      <g className="salpa-head" {...strokeProps}>
        <path d={HEAD_PATH} strokeOpacity={0.38} strokeWidth={BODY_WIDTH} />
        <circle
          cx={EYE.cx}
          cy={EYE.cy}
          r={EYE.r}
          fill="currentColor"
          fillOpacity={0.3}
          stroke="none"
        />
      </g>

      <g className="salpa-scales">
        {SCALE_BANDS.map((d) => (
          <path key={d} d={d} strokeOpacity={0.24} strokeWidth={DETAIL_WIDTH} {...strokeProps} />
        ))}
      </g>

      {/* Eye: still blinks, just far more slowly while resting. */}
      <circle
        className="salpa-eye"
        cx={EYE.cx}
        cy={EYE.cy}
        r={EYE.r}
        fill="currentColor"
        fillOpacity={0.3}
        stroke="none"
      />
    </g>
  );
}
