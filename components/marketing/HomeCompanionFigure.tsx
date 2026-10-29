"use client";

import { useId, forwardRef, ReactNode } from "react";

export type HomeCompanionFigureProps = {
  className?: string;
  headRef?: React.RefObject<SVGGElement | null> | null;
};

export const HomeCompanionFigure = forwardRef<HTMLDivElement, HomeCompanionFigureProps>(
  (props, bodyref) => {
    const uid = useId().replace(/:/g, "");
    const ivory = "sm-ivory-" + uid;
    const eye = "sm-eye-" + uid;

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
              <g data-part="eye-left" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
                <circle cx="37" cy="73" r="14" fill={`url(#${eye})`} />
                <circle cx="32.2" cy="66.6" r="4.8" fill="#ffffff" />
                <circle cx="42.2" cy="78.6" r="2" fill="#8a8a8a" opacity="0.8" />
              </g>
              <g data-part="eye-right" style={{ transformBox: "fill-box", transformOrigin: "center" }}>
                <circle cx="91" cy="73" r="14" fill={`url(#${eye})`} />
                <circle cx="86.2" cy="66.6" r="4.8" fill="#ffffff" />
                <circle cx="96.2" cy="78.6" r="2" fill="#8a8a8a" opacity="0.8" />
              </g>
            </g>
          </g>
        </svg>
      </div>
    );
  }
);

export default HomeCompanionFigure;
