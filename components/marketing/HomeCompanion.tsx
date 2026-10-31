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

  // -- Controller state ----------------------------------------------
  const animationTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isResettingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const startGeneration = useRef(0);
  const isAnimationScheduled = useRef(false);

  useEffect(() => {
    if (typeof window === "undefined") return;

    // Respect reduced motion preference
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const svg = bodyRef.current?.querySelector("svg");
    if (!svg) return;
    const bodyGroup = svg.querySelector("[data-part='body']") as SVGGElement | null;
    bodyGroupRef.current = bodyGroup as SVGGElement | null;
    const eyeBounceGroup = svg.querySelector("[data-part='eyes-bounce']") as SVGGElement | null;

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
    const GRAVITY = 0.0012; // vb/msÂ² - downward acceleration
    const RESTITUTION = 0.68; // energy retained per bounce (0 < r < 1)
    const FLOOR = 95; // vb units â€” floor/landing position (verified from geometry)
    const SETTLE_VELOCITY = 0.03; // vb/ms â€” stop when velocity this small
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

    let cursorGazeTarget: { x: number; y: number } | null = null;
    let currentEyeX = 0;
    let currentEyeY = 0;

    const handlePointerMove = (event: PointerEvent) => {
      const target = event.target;
      const interactive = target instanceof Element
        ? target.closest("a[href], button:not(:disabled), [role='button']")
        : null;

      if (!interactive || !eyeBounceGroup) {
        cursorGazeTarget = null;
        return;
      }

      const targetRect = interactive.getBoundingClientRect();
      const eyeRect = eyeBounceGroup.getBoundingClientRect();
      const dx = targetRect.left + targetRect.width / 2 -
        (eyeRect.left + eyeRect.width / 2);
      const dy = targetRect.top + targetRect.height / 2 -
        (eyeRect.top + eyeRect.height / 2);
      const length = Math.max(1, Math.hypot(dx, dy));

      cursorGazeTarget = {
        x: (dx / length) * 9,
        y: (dy / length) * 9
      };
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: true });
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
      const JUMP_APEX = 152;  // body jump height, increased by another 30%

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

        // Keep the eyes forward during the first complete body jump.
        // Gradually activate body tracking during the second jump.
        if (eyeBounceGroup) {
          let gazeActivation = 0;

          if (bodyT >= JUMP_DURATION_MS) {
            const activationProgress = Math.max(
              0,
              Math.min(1, (bodyT - JUMP_DURATION_MS) / 350)
            );
            gazeActivation =
              activationProgress * activationProgress *
              (3 - 2 * activationProgress);
          }

          const targetX = horizontalPosBody - horizontalPos;
          const targetY = 104 + verticalPosBody - verticalPos;
          const targetLength = Math.max(1, Math.hypot(targetX, targetY));
          const gazeStrength = 9;
          const bodyEyeX = (targetX / targetLength) * gazeStrength * gazeActivation;
          const bodyEyeY = (targetY / targetLength) * gazeStrength * gazeActivation;
          const desiredEyeX = cursorGazeTarget?.x ?? bodyEyeX;
          const desiredEyeY = cursorGazeTarget?.y ?? bodyEyeY;

          currentEyeX += (desiredEyeX - currentEyeX) * 0.16;
          currentEyeY += (desiredEyeY - currentEyeY) * 0.16;

          eyeBounceGroup.setAttribute(
            "transform",
            "translate(" + currentEyeX + ", " + currentEyeY + ")"
          );
        }
      }

      // The body loop must continue after the head has settled.
      if (!physState.settled || bodyJumpStartedRef.current) {
        rafRef.current = requestAnimationFrame(animate);
      }
    };

    // Idempotent start / reset lifecycle
    const startAnimation = () => {
      // Guard: don't restart if a 700ms pause is already scheduled
      // and the hero is still visible (prevents duplicate starts from
      // repeated observer callbacks while the hero remains visible).
      if (isAnimationScheduled.current) return;
      isAnimationScheduled.current = true;

      // Cancel any pending reset or unfinished animation
      isResettingRef.current = false;
      if (animationTimeoutRef.current !== null) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      // Clear all old transforms before starting fresh
      if (headRef.current) {
        headRef.current.removeAttribute("transform");
      }
      const eyeBounce = bodyRef.current?.querySelector("[data-part='eyes-bounce']");
      eyeBounce?.removeAttribute("transform");
      if (bodyGroupRef.current) {
        bodyGroupRef.current.removeAttribute("transform");
      }
      // Reset all animation state variables
      start = 0;
      physState.initialized = false;
      physState.velocity = 0;
      physState.position = 0;
      physState.bounceCount = 0;
      physState.settled = false;
      physState.lastTime = 0;
      bodyJumpStartedRef.current = false;
      bodyJumpIndexRef.current = 0;
      bodyJumpStartRef.current = 0;
      // Schedule the original 700ms pause, then begin the animation
      animationTimeoutRef.current = setTimeout(() => {
        start = performance.now();
        animate(performance.now());
        isAnimationScheduled.current = false;
      }, 700);
    };

    // -- Initial visibility guard --------------------------------------
    // Determine whether hero intersects the viewport on mount.
    // Do not require the entire hero section to fit inside the viewport.
    let initialIntersecting = false;
    if (hero) {
      const hr = hero.getBoundingClientRect();
      const vp = document.documentElement.clientHeight;
      const vw = document.documentElement.clientWidth;
      const inView =
        hr.top < vp && hr.bottom > 0 && hr.left < vw && hr.right > 0;
      initialIntersecting = inView;
    }

    // -- Create observer and keep ref for cleanup --------------------
    const observer = new IntersectionObserver(
      (entries) => {
        const gen = startGeneration.current;
        if (entries[0].isIntersecting) {
          // Hero re-entered viewport � replay from beginning
          // Only start if a 700ms pause is not already scheduled (prevents
          // repeated callbacks while the hero remains visible).
          if (!isAnimationScheduled.current) {
            if (isResettingRef.current && startGeneration.current === gen) {
              isResettingRef.current = false;
            }
            startAnimation();
          }
        } else {
          // Hero left viewport � begin smooth reset using the same controller
          // and clear the animation-scheduled flag so a later re-entry
          // will start the animation afresh.
          isResettingRef.current = true;
          isAnimationScheduled.current = false;
          if (animationTimeoutRef.current !== null) {
            clearTimeout(animationTimeoutRef.current);
            animationTimeoutRef.current = null;
          }
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          // Record current positions, then animate them to rest over ~400ms
          const headTransform = headRef.current?.getAttribute("transform") || "none";
          const bodyTransform = bodyGroupRef.current?.getAttribute("transform") || "none";
          const eyeTransform = eyeBounceGroup?.getAttribute("transform") || "none";

          const startTime = performance.now();
          const duration = 400;

          const step = (now: number) => {
            if (startGeneration.current !== gen) return;
            const t = now - startTime;
            const progress = Math.min(t / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);

            let newHeadTx = 0, newHeadTy = 0;
            if (headTransform !== "none") {
              const m = headTransform.match(/translate\(([^)]+)\)/);
              if (m) {
                const [, vals] = m;
                const v = vals.split(",").map(Number);
                newHeadTx = v[0] * (1 - ease);
                newHeadTy = v[1] * (1 - ease);
              }
            }

            let newBodyTx = 0, newBodyTy = 0;
            if (bodyTransform !== "none") {
              const m = bodyTransform.match(/translate\(([^)]+)\)/);
              if (m) {
                const [, vals] = m;
                const v = vals.split(",").map(Number);
                newBodyTx = v[0] * (1 - ease);
                newBodyTy = v[1] * (1 - ease);
              }
            }

            let newEyeTx = 0, newEyeTy = 0;
            if (eyeTransform !== "none") {
              const m = eyeTransform.match(/translate\(([^)]+)\)/);
              if (m) {
                const [, vals] = m;
                const v = vals.split(",").map(Number);
                newEyeTx = v[0] * (1 - ease);
                newEyeTy = v[1] * (1 - ease);
              }
            }

            if (headRef.current) {
              headRef.current.setAttribute(
                "transform",
                "translate(" + newHeadTx + ", " + newHeadTy + ")"
              );
            }
            if (bodyGroupRef.current) {
              bodyGroupRef.current.setAttribute(
                "transform",
                "translate(" + newBodyTx + ", " + newBodyTy + ")"
              );
            }
            if (eyeBounceGroup) {
              eyeBounceGroup.setAttribute(
                "transform",
                "translate(" + newEyeTx + ", " + newEyeTy + ")"
              );
            }

            if (progress < 1 && startGeneration.current === gen) {
              rafRef.current = requestAnimationFrame(step);
            } else {
              if (headRef.current) headRef.current.removeAttribute("transform");
              if (bodyGroupRef.current) bodyGroupRef.current.removeAttribute("transform");
              if (eyeBounceGroup) eyeBounceGroup.removeAttribute("transform");
            }
          };

          start = performance.now();
          rafRef.current = requestAnimationFrame(step);
        }
      },
      { root: null, threshold: 0.1 }
    );

    observerRef.current = observer;

    // Initial observe � this also captures the initial intersection state
    if (hero) {
      // If initially visible, start exactly once with the 700ms pause.
      // If initially outside viewport, remain at rest.
      if (initialIntersecting) {
        startAnimation();
      }
      observer.observe(hero);
    }

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      document.removeEventListener("pointermove", handlePointerMove);
      if (animationTimeoutRef.current !== null) {
        clearTimeout(animationTimeoutRef.current);
        animationTimeoutRef.current = null;
      }
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
      if (headRef.current) {
        headRef.current.removeAttribute("transform");
      }
      const eyeBounce = bodyRef.current?.querySelector("[data-part='eyes-bounce']");
      eyeBounce?.removeAttribute("transform");
      if (bodyGroupRef.current) {
        bodyGroupRef.current.removeAttribute("transform");
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
