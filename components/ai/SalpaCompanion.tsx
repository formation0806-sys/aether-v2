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
const BODY_PATH =
  "M 4.6 15.4 C 5.4 12.8 7.2 10.9 9.8 9.9 C 12.0 9.0 14.6 8.8 16.8 9.4 " +
  "C 18.4 9.8 19.8 10.4 20.9 11.1 C 20.2 12.0 19.0 12.5 17.6 12.7 " +
  "C 15.4 13.0 13.0 13.2 10.8 13.7 C 8.8 14.2 6.8 14.8 4.6 15.4 " +
  "C 3.6 14.6 2.9 13.5 2.7 12.3 C 2.9 13.2 3.5 14.4 4.6 15.4 Z";

/** Three overlapping scale arcs along the back. */
const SCALE_ARCS = [
  "M 7.6 13.0 C 8.0 11.9 8.6 10.9 9.4 10.1",
  "M 10.6 11.6 C 11.0 10.5 11.6 9.6 12.4 9.0",
  "M 13.8 10.9 C 14.1 10.0 14.6 9.2 15.2 8.6",
];

/** Two short feet beneath the belly. */
const FEET = ["M 9.4 14.2 L 9.4 15.6", "M 14.0 13.4 L 14.0 14.8"];

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

/** Base stroke width for the minimal variant. */
const MINIMAL_BODY_WIDTH = 1.15;
const MINIMAL_DETAIL_WIDTH = 1;

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
      viewBox="0 0 24 24"
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
    <g stroke="currentColor" strokeOpacity={0.9} {...strokeProps}>
      <path d={BODY_PATH} strokeWidth={MINIMAL_BODY_WIDTH} />
      {SCALE_ARCS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.5} strokeWidth={MINIMAL_DETAIL_WIDTH} />
      ))}
      {FEET.map((d) => (
        <path key={d} d={d} strokeOpacity={0.45} strokeWidth={MINIMAL_DETAIL_WIDTH} />
      ))}
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
        strokeWidth={2.1}
        filter="url(#salpa-holo-glow)"
        {...strokeProps}
      />
      {/* Sheened body. */}
      <path
        d={BODY_PATH}
        stroke="url(#salpa-holo-sheen)"
        strokeWidth={1.3}
        {...strokeProps}
      />
      {SCALE_ARCS.map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeOpacity={0.55}
          strokeWidth={0.95}
          {...strokeProps}
        />
      ))}
      {FEET.map((d) => (
        <path
          key={d}
          d={d}
          stroke="currentColor"
          strokeOpacity={0.4}
          strokeWidth={0.95}
          {...strokeProps}
        />
      ))}
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
      <path d={BODY_PATH} strokeOpacity={0.38} strokeWidth={1.2} {...strokeProps} />
      {SCALE_ARCS.map((d) => (
        <path key={d} d={d} strokeOpacity={0.22} strokeWidth={0.9} {...strokeProps} />
      ))}
      {FEET.map((d) => (
        <path key={d} d={d} strokeOpacity={0.2} strokeWidth={0.9} {...strokeProps} />
      ))}
    </g>
  );
}
