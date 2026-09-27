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
 * SALPA - the Humanoid Bust companion.
 *
 * A faceless, sculpted bust: a smooth ovoid head, a short neck, and broad
 * shoulders. There are no eyes, no mouth, and no hair. The character's entire
 * emotional language comes from posture, breathing, and the drift of light
 * across the form - which is what makes it read as a presence rather than a
 * mascot.
 *
 * The form is built from overlapping filled shapes with layered gradients, so
 * it reads as a softly modelled solid under a single key light from the upper
 * left, rather than as a flat glyph.
 *
 * Proportions in the 112x166 grid: the head occupies the upper third, the neck
 * is short, and the shoulders are the broadest mass, fading out at the base so
 * the bust reads as cropped rather than as a floating shape.
 */
const HEAD_PATH =
  "M 60 8 C 78 8 90 24 90 46 C 90 64 80 78 60 78 " +
  "C 40 78 30 64 30 46 C 30 24 42 8 60 8 Z";

/** A short neck, mostly in the shadow cast by the head above it. */
const NECK_PATH =
  "M 45 66 C 45 82 45 90 44 101 L 76 101 C 75 90 75 82 75 66 Z";

/** Shoulders and upper torso, fading to the base of the frame. */
const TORSO_PATH =
  "M 12 166 C 12 133 30 106 44 98 C 48 95 54 94 60 94 " +
  "C 66 94 72 95 76 98 C 90 106 108 133 108 166 Z";

/** Soft key-light highlight across the upper left of the skull. */
const HEAD_HIGHLIGHT =
  "M 41 32 C 45 17 55 11 63 12 C 53 17 45 27 43 41 " +
  "C 42 38 41 35 41 32 Z";

/** A narrower highlight along the lit edge of the left shoulder. */
const TORSO_HIGHLIGHT =
  "M 20 152 C 22 128 34 111 46 103 C 40 114 30 129 26 152 Z";

/**
 * The viewBox is cropped tight to the artwork so the bust fills the whole
 * rendered box: at the 224px welcome size the character is a large, dominant
 * presence rather than a small mark floating in empty space.
 */
const VIEWBOX = "4 4 112 166";

/**
 * Shared fill geometry so all three variants line up exactly. The bust is
 * entirely fill-based: no stroke appears anywhere, so the form reads as a
 * softly modelled solid rather than as line art. `fillRule` is declared here
 * so the overlapping masses compose predictably.
 */
const fillProps = {
  fill: "currentColor",
  fillRule: "nonzero" as const,
  stroke: "none",
};

/**
 * Material: soft ivory, slightly warmer and lighter than the greys Salpa
 * already uses, so the bust reads as a lit solid rather than as UI chrome.
 */
const IVORY = "#EDEAE4";
const IVORY_LIT = "#FBF9F5";
const IVORY_SHADE = "#8E8A84";

/** The neck sits in the head's cast shadow, one step below the lit ivory. */
const NECK_TONE = "#6E6B66";

/**
 * SalpaCompanion - the Salpa Humanoid Bust.
 *
 * Purely presentational and decorative:
 *   - no hooks, no application state, no data fetching, no effects;
 *   - inline SVG only, no external asset, no 3D and no animation dependency;
 *   - `aria-hidden`, so the bust is never focusable and never announced: it
 *     conveys nothing the surrounding text does not already carry.
 *
 * The character is intentionally FACELESS - no eyes, no mouth, no hair. Its
 * expression comes only from posture, breathing and lighting, which is what
 * separates it from a mascot.
 *
 * Motion: slow and small, defined in `app/globals.css` under
 * `prefers-reduced-motion: no-preference`, so a user who asks for reduced
 * motion receives a completely static bust.
 *
 * The component adds no layout box of its own, so the same component can be
 * rendered large in the welcome state and small in a message header.
 */
export default function SalpaCompanion({
  variant = "minimal",
  className,
}: SalpaCompanionProps) {
  return (
    <svg
      viewBox={VIEWBOX}
      fill="none"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-salpa-companion={variant}
    >
      {variant === "holographic" ? (
        <HolographicBust />
      ) : variant === "shadow" ? (
        <ShadowBust />
      ) : (
        <MinimalBust />
      )}
    </svg>
  );
}

/**
 * Variant B - the resting bust.
 *
 * The default Salpa presence: faceless, calm, and quietly lit. Layered fills
 * and gradients model the form under a single key light from the upper left, so
 * the bust reads as a sculpted solid rather than a flat glyph.
 *
 * Three independently animated groups keep it alive without any UI tell: the
 * torso breathes, the head drifts a degree or so, and the light breathes across
 * the surface. All three classes live in `app/globals.css` and are gated behind
 * `prefers-reduced-motion`.
 */
function MinimalBust() {
  return (
    <g className="salpa-torso" {...fillProps}>
      <defs>
        {/* A soft vertical falloff gives the shoulders volume. */}
        <linearGradient id="salpa-shoulder-grad" x1="0.2" y1="0" x2="0.75" y2="1">
          <stop offset="0%" stopColor={IVORY_LIT} />
          <stop offset="48%" stopColor={IVORY} />
          <stop offset="100%" stopColor={IVORY_SHADE} />
        </linearGradient>
        {/* The skull is lit hardest at the crown, falling to the jaw. */}
        <linearGradient id="salpa-head-grad" x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor={IVORY_LIT} />
          <stop offset="55%" stopColor={IVORY} />
          <stop offset="100%" stopColor={IVORY_SHADE} />
        </linearGradient>
        {/* A narrow rim of light down the trailing edge. */}
        <linearGradient id="salpa-rim-grad" x1="1" y1="0" x2="0" y2="0.4">
          <stop offset="0%" stopColor={IVORY_LIT} stopOpacity="0.55" />
          <stop offset="60%" stopColor={IVORY_LIT} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Shoulders and upper torso. */}
      <path d={TORSO_PATH} fill="url(#salpa-shoulder-grad)" />

      {/* Neck, in the shadow cast by the head. Drawn before the head so the
          head overlaps it cleanly. */}
      <path d={NECK_PATH} fill={NECK_TONE} />

      {/* Head: a smooth, entirely featureless ovoid. */}
      <g className="salpa-head">
        <path d={HEAD_PATH} fill="url(#salpa-head-grad)" />
        {/* Key light on the upper left of the skull. */}
        <path d={HEAD_HIGHLIGHT} fill={IVORY_LIT} fillOpacity={0.32} />
      </g>

      {/* Light drifting slowly across the form. */}
      <g className="salpa-light">
        <path d={TORSO_PATH} fill="url(#salpa-rim-grad)" />
        <path d={HEAD_PATH} fill="url(#salpa-rim-grad)" />
        <path d={TORSO_HIGHLIGHT} fill={IVORY_LIT} fillOpacity={0.12} />
      </g>
    </g>
  );
}

/**
 * Variant F - the thinking bust.
 *
 * The same faceless character, bound to the existing `isThinking` state. It
 * does not morph, spin, or pulse as a blob: the form is identical, and only
 * the motion and the light change. Breathing quickens, the head tilts a
 * fraction further, and the illumination strengthens, which reads as
 * concentration rather than as a loading indicator.
 *
 * The `salpa-active` class shortens every animation duration. There is no
 * rainbow, no chromatic aberration and no rapid motion, so it stays premium
 * rather than gaming-like.
 */
function HolographicBust() {
  return (
    <g className="salpa-active salpa-torso" {...fillProps}>
      <defs>
        <linearGradient id="salpa-think-shoulder" x1="0.2" y1="0" x2="0.75" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="50%" stopColor={IVORY_LIT} />
          <stop offset="100%" stopColor={IVORY_SHADE} />
        </linearGradient>
        <linearGradient id="salpa-think-head" x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor="#FFFFFF" />
          <stop offset="55%" stopColor={IVORY_LIT} />
          <stop offset="100%" stopColor={IVORY_SHADE} />
        </linearGradient>
        <linearGradient id="salpa-think-rim" x1="1" y1="0" x2="0" y2="0.4">
          <stop offset="0%" stopColor="#FFFFFF" stopOpacity="0.8" />
          <stop offset="60%" stopColor="#FFFFFF" stopOpacity="0" />
        </linearGradient>
        <filter id="salpa-think-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.4" />
        </filter>
        <clipPath id="salpa-think-clip">
          <path d={TORSO_PATH} />
          <path d={NECK_PATH} />
          <path d={HEAD_PATH} />
        </clipPath>
      </defs>

      {/* A restrained bloom behind the form. */}
      <g filter="url(#salpa-think-glow)" opacity={0.32}>
        <path d={TORSO_PATH} />
        <path d={HEAD_PATH} />
      </g>

      {/* Shoulders. */}
      <path d={TORSO_PATH} fill="url(#salpa-think-shoulder)" />

      {/* Neck. */}
      <path d={NECK_PATH} fill={NECK_TONE} />

      {/* Head. */}
      <g className="salpa-head">
        <path d={HEAD_PATH} fill="url(#salpa-think-head)" />
        <path d={HEAD_HIGHLIGHT} fill="#FFFFFF" fillOpacity={0.4} />
      </g>

      {/* Light sweeping slowly across the form as it processes. */}
      <g className="salpa-light">
        <path d={TORSO_PATH} fill="url(#salpa-think-rim)" />
        <path d={HEAD_PATH} fill="url(#salpa-think-rim)" />
        <path d={TORSO_HIGHLIGHT} fill="#FFFFFF" fillOpacity={0.16} />
      </g>
    </g>
  );
}

/**
 * Variant G - the quiet bust.
 *
 * For the calm, idle reading of the character: the same form held at low
 * contrast so it recedes into the black surface. The `salpa-resting` class
 * stretches every animation to roughly twice the length of the default, so it
 * still breathes but only barely registers.
 *
 * Not wired to any application state in the current chat experience.
 */
function ShadowBust() {
  return (
    <g className="salpa-resting salpa-torso" {...fillProps}>
      {/* Shoulders. */}
      <path d={TORSO_PATH} fill={IVORY} fillOpacity={0.3} />

      {/* Neck. */}
      <path d={NECK_PATH} fill={NECK_TONE} fillOpacity={0.7} />

      {/* Head. */}
      <g className="salpa-head">
        <path d={HEAD_PATH} fill={IVORY} fillOpacity={0.34} />
        <path d={HEAD_HIGHLIGHT} fill={IVORY_LIT} fillOpacity={0.1} />
      </g>
    </g>
  );
}
