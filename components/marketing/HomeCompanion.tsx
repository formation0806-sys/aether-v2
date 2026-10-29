"use client";

import { useRef, useEffect } from "react";
import HomeCompanionFigure from "./HomeCompanionFigure";

export default function HomeCompanion({ className }: { className?: string }) {
  const headRef = useRef<SVGGElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const bodyGroupRef = useRef<SVGGElement | null>(null);
  const bodyJumpStartedRef = useRef(false);
  const bodyJumpIndexRef = useRef(0);
  const bodyJumpStartRef = useRef(0);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Respect reduced motion preference
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const svg = bodyRef.current?.querySelector("svg");
    if (!svg) return;
    const bodyGroup = svg.querySelector("[data-part='body']") as SVGGElement | null;
    bodyGroupRef.current = bodyGroup as SVGGElement | null;

    // --- Determine travel distance from actual rendered geometry ---
    const hero = document.getElementById("hero");
    const heroRect = hero ? hero.getBoundingClientRect() : svg.getBoundingClientRect();
    const svgRect = svg.getBoundingClientRect();
    const viewBoxUnitsPerScreenPx = 128 / (svgRect.width || 140);

    // 35% of hero width, clamped 300-450px, then adjusted for overshoot
    let purePx = heroRect.width * 0.35;
    purePx = Math.max(300, Math.min(450, purePx));
    // Allow 10% overshoot peak without clipping at right edge
    const maxAllowedForOvershoot = (heroRect.right - svgRect.right - 8) / 1.1;
    purePx = Math.min(purePx, maxAllowedForOvershoot);
    purePx = Math.max(purePx, 0);

    const travelVb = purePx * viewBoxUnitsPerScreenPx;

// --- Measure "The mind" heading position for safe landing ---
const mindHeading = document.getElementById("mind-heading");
const mindRect = mindHeading ? mindHeading.getBoundingClientRect() : null;

// Calculate safe final landing position in viewBox units
// Default fallback: 80% of travelVb if heading cannot be measured
let safeFinalXVb = travelVb * 0.8;
if (mindRect && svgRect) {
  const bodyDiameterVb = 56; // body circle diameter (r=28 => diameter=56)
  const marginVb = 8; // safe margin in viewBox units
  const headingLeftVb = (mindRect.left - svgRect.left) / (svgRect.width || 140) * 128;
  const maxLandingVb = headingLeftVb - bodyDiameterVb - marginVb;
  safeFinalXVb = Math.max(0, Math.min(travelVb * 0.95, maxLandingVb));
}
    const horizontalDuration = 700;
    const bounceDuration = 2000; // 2000ms for the vertical bounce phase
    const animationTotalDuration = horizontalDuration + bounceDuration; // 2700ms total
    
    // Physics constants for ball bounce
    const GRAVITY = 0.0012; // vb/ms² - downward acceleration
    const RESTITUTION = 0.68; // energy retained per bounce (0 < r < 1)
    const FLOOR = 95; // vb units — floor/landing position (verified from geometry)
    const SETTLE_VELOCITY = 0.03; // vb/ms — stop when velocity this small
    let start = 0;

    // Physics state (persists across RAF frames via closure)
    const physState = {
      initialized: false,
      velocity: 0,
      position: 0,
      bounceCount: 0,
      settled: false,
      lastTime: 0,
    };

    const animate = (now: number) => {
      if (start === 0) start = now;
      const elapsed = now - start;
      let horizontalPos = 0;
      let verticalPos = 0;
      let settled = false;

      // === Phase A: smooth ease-out cubic horizontal travel (0 to 700ms) ===
      // Head moves from resting position to the right toward the CTA area
      // Vertical position stays at 0 (baseline) during horizontal travel
      if (elapsed < horizontalDuration) {
        // ease-out cubic: starts fast, decelerates smoothly to destination
        horizontalPos = travelVb * (1 - Math.pow(1 - elapsed / horizontalDuration, 3));
      } else {
        // === Phase B: physics-based vertical fall and bounce ===
        const bounceTime = elapsed - horizontalDuration; // ms since Phase B started
        horizontalPos = travelVb; // lock horizontal position

        // FLOOR defined at top of useEffect (95 vb units)
        if (bounceTime <= 0) {
          verticalPos = 0;
        } else {
          // Initialize physics state on first frame of Phase B
          if (!physState.initialized) {
            physState.initialized = true;
            physState.velocity = 0;
            physState.position = 0;
            physState.bounceCount = 0;
            physState.settled = false;
            physState.lastTime = bounceTime;
          }

          if (physState.settled) {
            verticalPos = FLOOR;
            settled = true;
          } else {
            // Cap deltaT for tab suspension stability
            let deltaT = bounceTime - physState.lastTime;
            if (deltaT > 50) deltaT = 50;
            if (deltaT < 0) deltaT = 0;

            // Apply gravity (velocity increases downward)
            physState.velocity += GRAVITY * deltaT;

            // Update position (position += velocity * deltaT)
            verticalPos = physState.position + physState.velocity * deltaT;

            // Floor collision detection
            if (verticalPos > FLOOR) {
              verticalPos = FLOOR;
              physState.bounceCount++;

              if (physState.bounceCount < 4) {
                // Rebound 1, 2, or 3: reverse velocity with restitution
                physState.velocity = -physState.velocity * RESTITUTION;
              } else {
                // 4th impact: settle permanently
                physState.settled = true;
                physState.velocity = 0;
                verticalPos = FLOOR;
              }
            }

            // Clamp to safe range (no clipping above -30 or below FLOOR)
            verticalPos = Math.max(-30, Math.min(verticalPos, FLOOR));

            physState.position = verticalPos;
            physState.lastTime = bounceTime;
          }
        }
      }

      if (headRef.current) {
        headRef.current.setAttribute("transform", "translate(" + horizontalPos + ", " + verticalPos + ")");
      }
      // --- Multi-jump body animation toward "The mind" heading ---
      const JUMP_COUNT = 3;
      const JUMP_DURATION_MS = 1210;  // 1000ms / 3 jumps
      const JUMP_APEX = 160;  // vertical arc height (pixels)

      // Body jump sequence starts after head settles
      if (physState.settled && !bodyJumpStartedRef.current) {
        bodyJumpStartedRef.current = true;
        bodyJumpStartRef.current = elapsed;
        bodyJumpIndexRef.current = 0;  // start with first jump
      }

      let bodyAnimDone = false;

      if (bodyJumpStartedRef.current && bodyGroupRef.current) {
        const bodyT = Math.max(0, elapsed - bodyJumpStartRef.current);
        const travelDuration = JUMP_COUNT * JUMP_DURATION_MS;
        let horizontalPosBody = safeFinalXVb;
        let verticalPosBody = 0;

        if (bodyT < travelDuration) {
          // Three smooth travelling jumps toward the mind heading.
          const jumpIndex = Math.min(
            Math.floor(bodyT / JUMP_DURATION_MS),
            JUMP_COUNT - 1
          );
          const p = Math.max(
            0,
            Math.min(
              1,
              (bodyT - jumpIndex * JUMP_DURATION_MS) / JUMP_DURATION_MS
            )
          );

          horizontalPosBody =
            safeFinalXVb *
            (jumpIndex + p) /
            JUMP_COUNT;

          verticalPosBody = -4 * JUMP_APEX * p * (1 - p);
        } else {
          // Continue bouncing vertically at the destination indefinitely.
          const repeatT = (bodyT - travelDuration) % JUMP_DURATION_MS;
          const p = repeatT / JUMP_DURATION_MS;
          verticalPosBody = -4 * JUMP_APEX * p * (1 - p);
        }

        bodyGroupRef.current.setAttribute(
          "transform",
          "translate(" + horizontalPosBody + ", " + verticalPosBody + ")"
        );
      }

      // The body loop must continue after the head has settled.
      if (!physState.settled || bodyJumpStartedRef.current) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    // Start animation after 700ms pause on page load
    const timer = setTimeout(() => animate(performance.now()), 700);
    return () => {
      clearTimeout(timer);
      cancelAnimationFrame(rafRef.current ?? 0);
      if (headRef.current) {
        headRef.current.removeAttribute("transform");
      }
    };
  }, []);

  return (
    <div
      className="salpa-hero-companion"
      style={{ animation: "none" }}
      role="img"
      aria-label="SALPA companion"
    >
      <HomeCompanionFigure ref={bodyRef} headRef={headRef} />
    </div>
  );
}

