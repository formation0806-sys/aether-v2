"use client";

import { useEffect, useRef, useState } from "react";
import HomeCompanionFigure from "@/components/marketing/HomeCompanionFigure";
import { createPortal } from "react-dom";

export type ChatHumanoidProps = {
  className?: string;
  reducedMotion?: boolean;
  animateEntrance?: boolean;
  onEntranceComplete?: () => void;
  gazeDown?: boolean;
};

export function ChatHumanoid({
  className,
  reducedMotion = false,
  animateEntrance = false,
  onEntranceComplete,
}: ChatHumanoidProps) {
  const figureRef = useRef<HTMLDivElement | null>(null);
  const headRef = useRef<SVGGElement | null>(null);
  const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

  useEffect(() => {
    setPortalRoot(document.body);
  }, []);
  const completedRef = useRef(false);
  const onEntranceCompleteRef = useRef(onEntranceComplete);

  useEffect(() => {
    onEntranceCompleteRef.current = onEntranceComplete;
  }, [onEntranceComplete]);

  useEffect(() => {
    if (!animateEntrance || !portalRoot) return;

    const figure = figureRef.current;
    const head = headRef.current;
    const body = figure?.querySelector<SVGGElement>("[data-part='body']");

    if (!figure || !head || !body) return;

    const headCircle = head.querySelector<SVGCircleElement>('circle[data-salpa-home-figure="circle"]');
    const bodyCircle = body.querySelector<SVGCircleElement>("circle");
    if (!headCircle || !bodyCircle) return;

    let cancelled = false;
    let bodyAnimation: Animation | undefined;
    let headAnimation: Animation | undefined;

    completedRef.current = false;

    const finish = () => {
      if (cancelled || completedRef.current) return;
      completedRef.current = true;
      onEntranceCompleteRef.current?.();
    };

    const prefersReduced =
      reducedMotion ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReduced) {
      finish();
      return () => {
        cancelled = true;
      };
    }

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const landingTarget = document.querySelector<HTMLElement>("[data-salpa-welcome-target]");
    const landingRect = landingTarget?.getBoundingClientRect();
    const landingX = landingRect
      ? landingRect.left + landingRect.width / 2 - vw / 2
      : 0;
    const landingY = landingRect
      ? landingRect.top + landingRect.height / 2 - vh / 2
      : 0;
    const duration = 2688;

    const bodyRadius = 14;
    const headRadius = 32;

    const bodyStartX = vw / 2 + bodyRadius + 60;
    const headStartX = -(vw / 2 + headRadius + 60);
    const headEdgeX = -headCircle.getBoundingClientRect().left;
    const bodyEdgeX = vw - bodyCircle.getBoundingClientRect().right;

    const headRect = headCircle.getBoundingClientRect();
    const bodyRect = bodyCircle.getBoundingClientRect();

    const headTopY = -headRect.top;
    const headBottomY = vh - headRect.bottom;
    const bodyTopY = -bodyRect.top;
    const bodyBottomY = vh - bodyRect.bottom;

    // One coordinated entrance, one rebound, then settle.
    const bodyKeyframes: Keyframe[] = [
      {
        transform: `translateX(${bodyStartX}px) translateY(${vh * 0.15 - 70}px)`,
        opacity: 0,
        offset: 0,
      },
      {
        transform: `translateX(${bodyEdgeX}px) translateY(${bodyTopY}px)`,
        opacity: 1,
        offset: 0.48,
        easing: "cubic-bezier(0.22, 0, 0.36, 1)",
      },
      {
        transform: `translateX(${bodyEdgeX * 0.55}px) translateY(${bodyBottomY}px)`,
        opacity: 1,
        offset: 0.76,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      {
        transform: `translateX(${landingX}px) translateY(${landingY}px)`,
        opacity: 1,
        offset: 1,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    ];

    const headKeyframes: Keyframe[] = [
      {
        transform: `translateX(${headStartX}px) translateY(${vh * 0.1 + 34}px)`,
        opacity: 0,
        offset: 0,
      },
      {
        transform: `translateX(${headEdgeX}px) translateY(${headTopY}px)`,
        opacity: 1,
        offset: 0.48,
        easing: "cubic-bezier(0.22, 0, 0.36, 1)",
      },
      {
        transform: `translateX(${headEdgeX * 0.55}px) translateY(${headBottomY}px)`,
        opacity: 1,
        offset: 0.76,
        easing: "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      {
        transform: `translateX(${landingX}px) translateY(${landingY}px)`,
        opacity: 1,
        offset: 1,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
      },
    ];
    const easing = "cubic-bezier(0.22, 1, 0.36, 1)";

    bodyAnimation = body.animate(bodyKeyframes, {
      duration,
      easing,
      fill: "forwards",
    });

    headAnimation = head.animate(headKeyframes, {
      duration,
      delay: 141,
      easing,
      fill: "forwards",
    });

    Promise.all([
      bodyAnimation.finished,
      headAnimation.finished,
    ]).then(finish).catch(() => {
      // Animation cancellation during unmount is expected.
    });

    return () => {
      cancelled = true;

      bodyAnimation?.cancel();
      headAnimation?.cancel();
      body.style.transform = "";
      head.style.transform = "";
      body.style.opacity = "";
      head.style.opacity = "";
    };
  }, [animateEntrance, reducedMotion, portalRoot]);

  if (animateEntrance) {
    return portalRoot
      ? createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center overflow-hidden bg-black"
            style={{ width: "100vw", height: "100dvh" }}
          >
            <div
              style={{
                transform: "scale(1)",
                transformOrigin: "center center",
              }}
            >
              <HomeCompanionFigure
                width="109px"
                ref={figureRef}
                headRef={headRef}
              />
            </div>
          </div>,
          portalRoot
        )
      : null;
  }

  return (
    <div className={className}>
      <HomeCompanionFigure width="109px" />
    </div>
  );
}

export default ChatHumanoid;
