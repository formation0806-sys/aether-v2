"use client";

import { useId, forwardRef, ReactNode, useEffect, useRef } from "react";

export type HomeCompanionFigureProps = {
  className?: string;
  headRef?: React.RefObject<SVGGElement | null> | null;
  trackInteractiveGaze?: boolean;
};

export const HomeCompanionFigure = forwardRef<HTMLDivElement, HomeCompanionFigureProps>(
  (props, bodyref) => {
    const uid = useId().replace(/:/g, "");
    const ivory = "sm-ivory-" + uid;
    const eye = "sm-eye-" + uid;
    const eyesRef = useRef<SVGGElement | null>(null);

    useEffect(() => {
      if (!props.trackInteractiveGaze) return;

      const eyes = eyesRef.current;
      if (!eyes) return;

      let currentX = 0;
      let currentY = 0;
      let targetX = 0;
      let targetY = 0;
      let frame = 0;

      const animateGaze = () => {
        currentX += (targetX - currentX) * 0.16;
        currentY += (targetY - currentY) * 0.16;

        if (
          Math.abs(targetX - currentX) < 0.01 &&
          Math.abs(targetY - currentY) < 0.01
        ) {
          currentX = targetX;
          currentY = targetY;
          eyes.setAttribute("transform", `translate(${currentX}, ${currentY})`);
          frame = 0;
          return;
        }

        eyes.setAttribute("transform", `translate(${currentX}, ${currentY})`);
        frame = requestAnimationFrame(animateGaze);
      };

      const handlePointerMove = (event: PointerEvent) => {
        const target = event.target;
        const cta = target instanceof Element
          ? target.closest("#future a[href='/signup']")
          : null;

        if (!cta) {
          targetX = 0;
          targetY = 0;
        } else {
          const buttonRect = cta.getBoundingClientRect();
          const eyesRect = eyes.getBoundingClientRect();
          const dx = buttonRect.left + buttonRect.width / 2 -
            (eyesRect.left + eyesRect.width / 2);
          const dy = buttonRect.top + buttonRect.height / 2 -
            (eyesRect.top + eyesRect.height / 2);
          const distance = Math.max(1, Math.hypot(dx, dy));

          targetX = (dx / distance) * 9;
          targetY = (dy / distance) * 9;
        }

        if (!frame) frame = requestAnimationFrame(animateGaze);
      };

      document.addEventListener("pointermove", handlePointerMove, { passive: true });

      return () => {
        document.removeEventListener("pointermove", handlePointerMove);
        if (frame) cancelAnimationFrame(frame);
        eyes.removeAttribute("transform");
      };
    }, [props.trackInteractiveGaze]);

    return (
      <div
        style={{ width: "clamp(140px, 16vw, 320px)", overflow: "visible" }}
        ref={bodyref}
        data-part="wrapper"
        className={props.className}
      >
        <svg
          viewBox="0 0 128 196"
          aria-hidden="true"
          pointerEvents="none"
          style={{ display: "block", width: "100%", height: "auto", overflow: "visible" }}
        >
          <defs>
            <radialGradient id={ivory} cx="35%" cy="30%" r="75%">
              <stop offset="0" stopColor="#ffffff" />
              <stop offset="0.45" stopColor="#f4f2ee" />
              <stop offset="1" stopColor="#d8d5ce" />
            </radialGradient>
            <radialGradient id={eye} cx="40%" cy="35%" r="70%">
              <stop offset="0" stopColor="#2a2a2a" />
              <stop offset="0.6" stopColor="#0b0b0b" />
              <stop offset="1" stopColor="#000000" />
            </radialGradient>
          </defs>

          <g data-part="body" className="salpa-home-body-group">
            <circle cx="64" cy="168" r="28" fill={`url(#${ivory})`} />
          </g>

          <g
            data-part="head"
            className="salpa-home-head"
            ref={props.headRef}
          >
            <circle
              cx="64"
              cy="64"
              r="64"
              fill={`url(#${ivory})`}
              data-salpa-home-figure="circle"
            />
            <g data-part="eyes" className="salpa-gaze">
              <g data-part="eyes-bounce" ref={eyesRef} style={{ transformBox: "fill-box", transformOrigin: "center" }}>
                <g data-part="eye-left">
                  <circle cx="37" cy="73" r="14" fill={`url(#${eye})`} />
                  <circle cx="32.2" cy="66.6" r="4.8" fill="#ffffff" />
                  <circle cx="42.2" cy="78.6" r="2" fill="#8a8a8a" opacity="0.8" />
                </g>
                <g data-part="eye-right">
                  <circle cx="91" cy="73" r="14" fill={`url(#${eye})`} />
                  <circle cx="86.2" cy="66.6" r="4.8" fill="#ffffff" />
                  <circle cx="96.2" cy="78.6" r="2" fill="#8a8a8a" opacity="0.8" />
                </g>
              </g>
            </g>
          </g>
        </svg>
      </div>
    );
  }
);

export default HomeCompanionFigure;
