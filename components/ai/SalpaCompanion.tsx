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
 * The pangolin body outline, in a 24x24 grid, drawn in profile and facing
 * right: scalloped scale arcs across the back, a small snout, a tapering
 * tail to the left, and two short feet.
 *
 * One shared path for every variant so the silhouette stays identical and
 * only the treatment changes.
 */
/**
 * The pangolin, drawn in profile facing right inside a 64x46 grid that is
 * fitted tightly to the artwork, so the animal fills roughly 90% of the
 * available area instead of floating in empty space.
 *
 * Read from front to back, the silhouette carries the four features that make
 * a pangolin recognisable at a glance: a pointed snout, a domed and arched
 * back, a heavy tapering tail, and short clawed feet. The overlapping armour
 * is expressed by the three SCALE_BANDS, which follow the curve of the back
 * and read as the layered plates that give a pangolin its texture.
 *
 * All geometry is shared by every variant, so the silhouette stays identical
 * and only the treatment changes.
 */
const BODY_PATH =
  "M 60.5 20 C 56.5 14 49.5 8.5 41.5 6 C 31 3 20 6 13 12 " +
  "C 7 17 2.5 25 1.5 32 C 1 35 2.5 38.5 5 39 C 7 39.5 8.5 37 8 34.5 " +
  "C 9 38 12 39.5 15 39 C 20 38.5 27 37.5 33 36 C 40 34.5 46 32 50 29 " +
  "C 54 26 57.5 23 60.5 20 Z";

/** Three curved plates across the back: the pangolin's overlapping armour. */
const SCALE_BANDS = [
  "M 24 13.5 C 21 20 20 27 22 33.5",
  "M 33 8.5 C 30.5 16 30 24 32 33",
  "M 42 8 C 40.5 15 41 23 44 30.5",
];

/** Two rings banding the tapering tail. */
const TAIL_BANDS = [
  "M 6.5 23 C 8 26 8.5 29 8 32",
  "M 11.5 17 C 13 20.5 13.5 24 13 28",
];

/** Two short feet under the body. */
const LEGS = ["M 26 37 L 24.5 43", "M 40 34.5 L 41.5 41.5"];

/** The eye: a single filled dot, the detail that makes it read as an animal. */
const EYE = { cx: 52.5, cy: 18, r: 1.05 };

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
const BODY_WIDTH = 1.8;
const DETAIL_WIDTH = 1.35;

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
      viewBox="0 0 64 46"
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
 * normal chat, listening, responding and welcome. Completely still, so it
 * never competes with message content.
 */
function MinimalPangolin() {
  return (
    <g stroke="currentColor" strokeOpacity={0.92} {...strokeProps}>
      <path d={BODY_PATH} strokeWidth={BODY_WIDTH} />
      {SCALE_BANDS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.6} strokeWidth={DETAIL_WIDTH} />
      ))}
      {TAIL_BANDS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.5} strokeWidth={DETAIL_WIDTH} />
      ))}
      {LEGS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.6} strokeWidth={DETAIL_WIDTH} />
      ))}
      <circle
        cx={EYE.cx}
        cy={EYE.cy}
        r={EYE.r}
        fill="currentColor"
        stroke="none"
      />
    </g>
  );
}

/**
 * Variant F - holographic pangolin.
 *
 * Reserved for when Salpa is genuinely active (thinking, long-running work).
 * The effect is a slow, low-amplitude opacity breath plus a faint same-hue
 * sheen and a soft edge glow, all derived from `currentColor`. There is no
 * rainbow, no chromatic aberration and no rapid motion, so it stays premium
 * rather than gaming-like.
 *
 * Not wired to any application state in the current chat experience.
 */
function HolographicPangolin() {
  return (
    <g className="motion-safe:animate-pulse motion-safe:[animation-duration:6s]">
      <defs>
        <linearGradient id="salpa-holo-sheen" x1="0" y1="1" x2="1" y2="0">
          <stop offset="0%" stopColor="currentColor" stopOpacity={0.45} />
          <stop offset="45%" stopColor="currentColor" stopOpacity={0.95} />
          <stop offset="100%" stopColor="currentColor" stopOpacity={0.5} />
        </linearGradient>
        <filter id="salpa-holo-glow" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur stdDeviation="0.7" />
        </filter>
      </defs>

      {/* Soft same-hue halo. */}
      <path
        d={BODY_PATH}
        stroke="currentColor"
        strokeOpacity={0.22}
        strokeWidth={3}
        filter="url(#salpa-holo-glow)"
        {...strokeProps}
      />
      {/* Sheened body. */}
      <path
        d={BODY_PATH}
        stroke="url(#salpa-holo-sheen)"
        strokeWidth={2}
        {...strokeProps}
      />
      {SCALE_BANDS.map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeOpacity={0.6}
          strokeWidth={DETAIL_WIDTH}
          {...strokeProps}
        />
      ))}
      {TAIL_BANDS.map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeOpacity={0.5}
          strokeWidth={DETAIL_WIDTH}
          {...strokeProps}
        />
      ))}
      {LEGS.map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={DETAIL_WIDTH}
          {...strokeProps}
        />
      ))}
      <circle
        cx={EYE.cx}
        cy={EYE.cy}
        r={EYE.r}
        fill="currentColor"
        stroke="none"
      />
    </g>
  );
}

/**
 * Variant G - shadow pangolin.
 *
 * Reserved for the quiet, idle state: a very dark silhouette that recedes
 * into the black surface. The motion is the slowest of the three and stays
 * within a barely perceptible opacity band.
 *
 * Not wired to any application state in the current chat experience.
 */
function ShadowPangolin() {
  return (
    <g
      className="motion-safe:animate-pulse motion-safe:[animation-duration:9s]"
      stroke="currentColor"
    >
      <path d={BODY_PATH} strokeOpacity={0.38} strokeWidth={BODY_WIDTH} {...strokeProps} />
      {SCALE_BANDS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.24} strokeWidth={DETAIL_WIDTH} {...strokeProps} />
      ))}
      {TAIL_BANDS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.2} strokeWidth={DETAIL_WIDTH} {...strokeProps} />
      ))}
      {LEGS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.22} strokeWidth={DETAIL_WIDTH} {...strokeProps} />
      ))}
      <circle
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
