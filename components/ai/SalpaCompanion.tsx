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
 * The pangolin: a filled, solid side-profile character.
 *
 * A pangolin reads as a pangolin because of four things, and the geometry is
 * built around exactly those: a SMALL pointed head, a LARGE domed and heavily
 * armoured torso, a LONG thick tail that tapers to a point, and layered
 * plates across the back. Everything else is restraint.
 *
 * Proportions across the 96-unit animal, front to back:
 *   head  x 72..96  (~25%)  small, low, snout angled forward and down
 *   body  x 34..80  (~48%)  the big rounded armour mass; the clear centre
 *   tail  x  3..48  (~46%)  thick at the root, sweeping back and tapering
 *
 * The tail root (x 38..48) and the neck (x 72..78) both sit well INSIDE the
 * neighbouring mass, so the few degrees of rotation the animation applies can
 * never tear a visible gap along the joint.
 *
 * The back rises to y 11 and the belly sits at y 50, so the torso is taller
 * than it is long - a domed, hunched animal rather than a flat slug.
 *
 * Overall extent: x 3..96, y 11..59.
 */
const BODY_PATH =
  "M 36 47 C 36 27 48 11 60 11 C 71 11 79 22 80 34 " +
  "C 81 44 73 50 61 50 C 48 50 38 50 36 47 Z";

/** Small head with a pointed snout; overlaps the body across x 67..73. */
const HEAD_PATH =
  "M 74 30 C 74 23 79 19 85 20 C 89 21 93 25 96 28 " +
  "C 97 30 96 32 93 33 C 89 35 84 37 79 37 C 75 37 73 34 74 30 Z";

/** Heavy tapering tail sweeping down and left, tucked behind the body. */
const TAIL_PATH =
  "M 48 26 C 36 28 24 33 14 40 C 8 44 4 49 3 52 " +
  "C 8 51 14 48 20 44 C 29 38 38 34 45 33 C 48 32 49 29 48 26 Z";

/** Five large armour plates laid over the domed back, overlapping each other. */
const ARMOUR_PLATES = [
  "M 40 47 C 38 30 40 17 45 12 C 50 17 52 30 50 47 C 47 42 43 42 40 47 Z",
  "M 50 48 C 48 30 50 15 55 11 C 60 15 62 30 60 48 C 57 43 53 43 50 48 Z",
  "M 60 48 C 58 30 60 15 65 12 C 70 15 72 30 70 48 C 67 43 63 43 60 48 Z",
  "M 70 47 C 68 31 70 20 75 17 C 80 20 82 31 80 47 C 77 42 73 42 70 47 Z",
  "M 46 47 C 44 32 46 21 50 17 C 54 21 56 32 55 47 C 52 42 49 42 46 47 Z",
  "M 34 46 C 33 34 35 25 39 22 C 43 25 45 34 44 46 C 41 42 37 42 34 46 Z",
];

/** Two short, stubby feet beneath the belly. */
const FEET = [
  "M 64 47 C 64 52 63 56 64 58 L 71 58 C 71 55 71 51 70 47 Z",
  "M 48 48 C 48 53 47 57 48 59 L 55 59 C 55 56 55 52 54 48 Z",
];

/** The eye: small, dark, and the detail that makes it read as an animal. */
const EYE = { cx: 86, cy: 27, r: 2.4 };

/**
 * Shared fill geometry so all three variants line up exactly.
 *
 * The companion is FILLED character art, not line art: the silhouette carries
 * the recognition, and the only strokes anywhere are the soft joins on the
 * feet. `fillRule` is declared here so the overlapping masses compose
 * predictably rather than punching holes in one another.
 */
const fillProps = {
  fill: "currentColor",
  fillRule: "nonzero" as const,
  stroke: "none",
};

/**
 * The armour is a LIGHTER neutral than the body, never black.
 *
 * On a black UI a black plate is simply invisible, and the overlapping scales
 * are precisely the detail that makes the silhouette read as a pangolin. A
 * near-white at low opacity sits just above the body's tone, so each plate
 * catches the eye as a distinct overlapping shell rather than as a stripe.
 */
const ARMOUR_TONE = "#F5F5F5";

/** The eye is the one genuinely dark mark: a small punch-out on the head. */
const EYE_TONE = "#0A0A0A";

/**
 * SalpaCompanion - the Salpa pangolin companion.
 *
 * Purely presentational and decorative:
 *   - no hooks, no application state, no data fetching, no effects;
 *   - inline SVG only, no external asset and no animation dependency;
 *   - `aria-hidden`, because the companion conveys no information that the
 *     surrounding text does not already carry.
 *
 * Design language: monochrome and FILLED, inheriting `currentColor` for the
 * body, head, tail and feet, with the armour a step lighter in the same neutral
 * family. There is no stroke anywhere, no saturated colour, and no cartoon
 * detail, so it sits naturally inside the existing black Salpa surfaces
 * (`#F5F5F5` / `#A0A0A0` / `#707070` on `#000000` / `#0A0A0A`).
 *
 * Motion: calm and small, defined in `app/globals.css` under
 * `prefers-reduced-motion: no-preference`, so a user who asks for reduced
 * motion receives a completely static companion.
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
      viewBox="2 9 96 52"
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
 * The primary Salpa companion identity: clean, premium, monochrome, filled.
 * Used for normal chat, listening, responding and welcome.
 *
 * The animal is built from five independently animated groups, so it reads as
 * a living character rather than a static glyph: the body breathes, the head
 * turns about the neck, the tail sways about the tail root, the armour shifts
 * faintly, and the eye blinks once per cycle. All five classes live in
 * `app/globals.css` and are gated behind `prefers-reduced-motion`.
 */
function MinimalPangolin() {
  return (
    <g className="salpa-body" {...fillProps}>
      {/* Tail: long and thick at the root, sweeping back to a fine point. */}
      <g className="salpa-tail">
        <path d={TAIL_PATH} fillOpacity={0.88} />
      </g>

      {/* Body: the large domed armour mass the silhouette is built around. */}
      <path d={BODY_PATH} fillOpacity={0.95} />

      {/* Head: small, snout angled forward and down. */}
      <g className="salpa-head">
        <path d={HEAD_PATH} fillOpacity={0.95} />
      </g>

      {/* Feet: short and stubby, just enough to ground the animal. */}
      <g fillOpacity={0.72}>
        {FEET.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Armour: lighter plates shingled over the back, shifting faintly. */}
      <g className="salpa-scales" fill={ARMOUR_TONE} fillOpacity={0.2}>
        {ARMOUR_PLATES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Eye: a small dark mark that makes the head read as a face. */}
      <circle className="salpa-eye" cx={EYE.cx} cy={EYE.cy} r={EYE.r} fill={EYE_TONE} />
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
    <g className="salpa-active salpa-body" {...fillProps}>
      <defs>
        <linearGradient id="salpa-holo-sheen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.55} />
          <stop offset="50%" stopColor="currentColor" stopOpacity={1} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.55} />
        </linearGradient>
        <filter id="salpa-holo-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="1.6" />
        </filter>
        <clipPath id="salpa-holo-clip">
          <path d={BODY_PATH} />
          <path d={HEAD_PATH} />
          <path d={TAIL_PATH} />
        </clipPath>
      </defs>

      {/* A soft same-hue halo behind the animal. */}
      <g filter="url(#salpa-holo-glow)" opacity={0.4}>
        <path d={TAIL_PATH} />
        <path d={BODY_PATH} />
        <path d={HEAD_PATH} />
      </g>

      {/* Tail. */}
      <g className="salpa-tail">
        <path d={TAIL_PATH} fillOpacity={0.88} />
      </g>

      {/* Body, sheened. */}
      <path d={BODY_PATH} fill="url(#salpa-holo-sheen)" />

      {/* Head. */}
      <g className="salpa-head">
        <path d={HEAD_PATH} fill="url(#salpa-holo-sheen)" />
      </g>

      {/* Feet. */}
      <g fillOpacity={0.72}>
        {FEET.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Armour plates, and a band of light travelling across them. */}
      <g className="salpa-scales" fill={ARMOUR_TONE} fillOpacity={0.22}>
        {ARMOUR_PLATES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g className="salpa-sweep" fill={ARMOUR_TONE} fillOpacity={0.18} clipPath="url(#salpa-holo-clip)">
        <rect x={10} y={0} width={18} height={70} fill={ARMOUR_TONE} />
      </g>

      {/* Eye. */}
      <circle className="salpa-eye" cx={EYE.cx} cy={EYE.cy} r={EYE.r} fill={EYE_TONE} />
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
    <g className="salpa-resting salpa-body" {...fillProps}>
      {/* Tail. */}
      <g className="salpa-tail">
        <path d={TAIL_PATH} fillOpacity={0.3} />
      </g>

      {/* Body. */}
      <path d={BODY_PATH} fillOpacity={0.34} />

      {/* Head. */}
      <g className="salpa-head">
        <path d={HEAD_PATH} fillOpacity={0.34} />
      </g>

      {/* Feet. */}
      <g fillOpacity={0.26}>
        {FEET.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Armour. */}
      <g className="salpa-scales" fill={ARMOUR_TONE} fillOpacity={0.07}>
        {ARMOUR_PLATES.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>

      {/* Eye: still blinks, just far more slowly while resting. */}
      <circle className="salpa-eye" cx={EYE.cx} cy={EYE.cy} r={EYE.r} fill="#000" fillOpacity={0.45} />
    </g>
  );
}
