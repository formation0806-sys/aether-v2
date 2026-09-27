type SalpaCompanionProps = {
  /**
   * Expression state. The character is the same form in all three; only the
   * eyes, the mouth curve and the head angle change.
   *
   *   idle       - direct eye contact, neutral mouth. The default.
   *   thinking   - gaze lifted and turned slightly aside, a small head tilt.
   *   responding - gaze returns to the viewer, mouth warmed very slightly.
   */
  state?: "idle" | "thinking" | "responding";
  /**
   * Tailwind classes supplied by the caller. The companion supplies its own
   * ivory material, so callers control SIZE ONLY - a colour here would fight
   * the sculpted shading rather than tint it.
   */
  className?: string;
};

/**
 * SALPA - the companion character.
 *
 * A smooth, elongated humanoid head with a short narrow neck and only a small
   * amount of shoulder geometry: the head is deliberately the dominant mass, so
 * the face reads at a glance and the form never becomes a large empty torso.
 *
 * The face is minimal by design. There is no hair, no ears, no nose, no brows,
 * no lips modelled as separate forms and no skin detail. The entire expression
 * is carried by two small dark eyes, a very shallow mouth line, and a slight
 * head angle - which is what keeps the character intelligent rather than
 * cartoonish.
 *
 * The form is entirely fill-based with layered gradients, so it reads as a
 * softly sculpted solid under a single key light from the upper left rather
 * than as a flat icon.
 */
/**
 * A large, smooth, egg-shaped head - the dominant mass of the character.
 * Spans y 8..88, which is roughly 70% of the visible figure.
 */
const HEAD_PATH =
  "M 60 8 C 81 8 93 27 93 49 C 93 72 79 88 60 88 " +
  "C 41 88 27 72 27 49 C 27 27 39 8 60 8 Z";

/** A very short neck, mostly hidden in the head's cast shadow. */
const NECK_PATH =
  "M 51 82 C 51 88 50 91 49 95 L 71 95 C 70 91 69 88 69 82 Z";

/**
 * A small rounded shoulder base that simply anchors the head. It is
 * deliberately narrow and shallow so the figure never reads as a torso.
 */
const TORSO_PATH =
  "M 32 112 C 34 104 42 98 51 96 C 55 94.8 65 94.8 69 96 " +
  "C 78 98 86 104 88 112 Z";

/** Soft key-light across the upper left of the skull. */
const HEAD_HIGHLIGHT =
  "M 39 32 C 43 16 55 10 65 11 C 53 16 44 28 42 42 " +
  "C 40.5 39 39.5 36 39 32 Z";

/** A narrow highlight along the lit edge of the left shoulder. */
const TORSO_HIGHLIGHT =
  "M 37 109 C 39 102 44 98 50 96.5 C 46 100 41 104 39.5 109 Z";

/**
 * The eyes: small, dark, almond, and set wide enough to read at 36px.
 * Sized up slightly from the previous pass so the expression stays legible
 * when the companion renders small in a message header.
 */
const EYE = { rx: 5.6, ry: 3.7, leftX: 46.5, rightX: 73.5, y: 47 };

/**
 * The mouth: one shallow curve. Neutral is almost flat; responding lifts the
 * ends by under a pixel of stroke. There is no lip volume and no open mouth.
 */
const MOUTH = { x: 60, y: 66, neutralSpan: 15, smileLift: 2.1 };

/**
 * A viewBox cropped tight to the artwork, so the head fills the rendered box
 * and the character is genuinely large at the sizes the chat uses.
 */
const VIEWBOX = "22 4 76 112";

/**
 * Shared fill geometry so the whole character lines up. It is entirely
 * fill-based: the body carries no stroke at all, and the only stroked paths are
 * the two eyes and the mouth, which need a real line to read at small sizes.
 * `fillRule` is declared here so the overlapping masses compose predictably.
 */
const fillProps = {
  fill: "currentColor",
  fillRule: "nonzero" as const,
  stroke: "none",
};

/**
 * Material: soft ivory, slightly warmer and lighter than the greys Salpa
 * already uses, so the figure reads as a lit solid rather than as UI chrome.
 */
const IVORY = "#EDEAE4";
const IVORY_LIT = "#FBF9F5";
const IVORY_SHADE = "#8E8A84";

/** The neck sits in the head's cast shadow, one step below the lit ivory. */
const NECK_TONE = "#6E6B66";

/**
 * The eyes and mouth are the only dark marks. They are a near-black that still
 * separates from the deepest shadow, so the face never turns into a smudge.
 */
const FEATURE_TONE = "#1A1917";

/** Per-state geometry: where the gaze sits and how much the mouth lifts. */
type StateSpec = {
  eyeDX: number;
  eyeDY: number;
  mouthLift: number;
  headTilt: number;
  lit: number;
};

const STATE: Record<"idle" | "thinking" | "responding", StateSpec> = {
  // Direct eye contact, relaxed mouth, level head.
  idle: { eyeDX: 0, eyeDY: 0, mouthLift: 0, headTilt: 0, lit: 0.34 },
  // Gaze lifted and turned slightly aside, with a small head tilt.
  thinking: { eyeDX: 2.2, eyeDY: -1.9, mouthLift: 0, headTilt: -2.6, lit: 0.46 },
  // Gaze returns to the viewer; the mouth warms by well under a millimetre.
  responding: { eyeDX: 0, eyeDY: 0.3, mouthLift: 1, headTilt: 0.8, lit: 0.4 },
};

/**
 * SalpaCompanion - the Salpa companion character.
 *
 * Purely presentational and decorative:
 *   - no hooks, no application state, no data fetching, no effects;
 *   - inline SVG only, no external asset, no 3D, no animation library;
 *   - `aria-hidden`, so the figure is never focusable and never announced. The
 *     companion is never the only way to understand state: the chat always
 *     renders a text label beside it.
 *
 * The form is identical in all three states. Only the gaze, the mouth curve,
 * the head angle and the lighting move, so the character never morphs, never
 * becomes a spinner, and never reads as a loading icon.
 *
 * Motion is slow and small, defined in `app/globals.css` under
 * `prefers-reduced-motion: no-preference`, so a user who asks for reduced
 * motion receives a completely static character in the correct state.
 *
 * The component adds no layout box of its own, so the same character renders
 * large in the welcome state and small in a message header.
 */
export default function SalpaCompanion({
  state = "idle",
  className,
}: SalpaCompanionProps) {
  const s = STATE[state];

  // A shallow arc: nearly flat when neutral, ends lifted when responding.
  const lift = MOUTH.smileLift * s.mouthLift;
  const half = MOUTH.neutralSpan / 2;
  const mouthPath =
    `M ${MOUTH.x - half} ${MOUTH.y - lift} ` +
    `C ${MOUTH.x - 5} ${MOUTH.y + 2.4 + lift} ` +
    `${MOUTH.x + 5} ${MOUTH.y + 2.4 + lift} ` +
    `${MOUTH.x + half} ${MOUTH.y - lift}`;

  return (
    <svg
      viewBox={VIEWBOX}
      fill="none"
      role="presentation"
      aria-hidden="true"
      focusable="false"
      className={className}
      data-salpa-companion={state}
    >
      <defs>
        {/* The skull is lit hardest at the crown and falls away to the jaw. */}
        <linearGradient id="salpa-c-head" x1="0.3" y1="0" x2="0.7" y2="1">
          <stop offset="0%" stopColor={IVORY_LIT} />
          <stop offset="55%" stopColor={IVORY} />
          <stop offset="100%" stopColor={IVORY_SHADE} />
        </linearGradient>
        <linearGradient id="salpa-c-shoulder" x1="0.2" y1="0" x2="0.75" y2="1">
          <stop offset="0%" stopColor={IVORY_LIT} />
          <stop offset="48%" stopColor={IVORY} />
          <stop offset="100%" stopColor={IVORY_SHADE} />
        </linearGradient>
        {/* A narrow rim of light down the trailing edge. */}
        <linearGradient id="salpa-c-rim" x1="1" y1="0" x2="0" y2="0.4">
          <stop offset="0%" stopColor={IVORY_LIT} stopOpacity="0.5" />
          <stop offset="60%" stopColor={IVORY_LIT} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Breathing: the whole figure rises and settles very slightly. */}
      <g className="salpa-bust" {...fillProps}>
        <path d={TORSO_PATH} fill="url(#salpa-c-shoulder)" />

        <path d={NECK_PATH} fill={NECK_TONE} />

        {/* The head tilts a degree or two about the base of the neck. */}
        <g className="salpa-head" style={{ transform: `rotate(${s.headTilt}deg)` }}>
          <path d={HEAD_PATH} fill="url(#salpa-c-head)" />
          <path d={HEAD_HIGHLIGHT} fill={IVORY_LIT} fillOpacity={s.lit} />

          {/* The face: two small eyes and one shallow mouth line. */}
          <g
            className="salpa-eyes"
            style={{ transform: `translate(${s.eyeDX}px, ${s.eyeDY}px)` }}
          >
            <ellipse cx={EYE.leftX} cy={EYE.y} rx={EYE.rx} ry={EYE.ry} fill={FEATURE_TONE} />
            <ellipse cx={EYE.rightX} cy={EYE.y} rx={EYE.rx} ry={EYE.ry} fill={FEATURE_TONE} />
          </g>

          <path
            d={mouthPath}
            stroke={FEATURE_TONE}
            strokeWidth="1.5"
            strokeLinecap="round"
            fill="none"
          />
        </g>

        {/* Light drifting slowly across the form. */}
        <g className="salpa-light">
          <path d={TORSO_PATH} fill="url(#salpa-c-rim)" />
          <path d={HEAD_PATH} fill="url(#salpa-c-rim)" />
          <path d={TORSO_HIGHLIGHT} fill={IVORY_LIT} fillOpacity={0.1} />
        </g>
      </g>
    </svg>
  );
}

