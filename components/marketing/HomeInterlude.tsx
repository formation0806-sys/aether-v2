"use client";
import { useEffect, useRef } from "react";
import Reveal from "@/components/marketing/Reveal";

/* Cinematic interlude — self-generated quiet particle drift.
   No external video hotlinked (licensing confidence). */
export default function HomeInterlude() {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    type P = { x: number; y: number; r: number; vx: number; vy: number; a: number; ph: number };
    let W = 0; let H = 0; let parts: P[] = [];
    let raf = 0; let inView = false; let gone = false;
    const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
    const seed = () => {
      const n = Math.max(28, Math.min(80, Math.round((W * H) / 24000)));
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        r: 0.6 + Math.random() * 1.7,
        vx: (Math.random() - 0.5) * 0.12, vy: (Math.random() - 0.5) * 0.1,
        a: 0.1 + Math.random() * 0.28, ph: Math.random() * 6.28,
      }));
    };
    const resize = () => {
      const r = wrap.getBoundingClientRect();
      W = Math.max(1, Math.round(r.width)); H = Math.max(1, Math.round(r.height));
      canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
      seed();
      if (reduced || gone) paintStill();
    };
    const paintStill = () => {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      for (const p of parts) {
        ctx.fillStyle = "rgba(240,238,230," + p.a.toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
    };
    const draw = (now: number) => {
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const t = now / 1000;
      ctx.lineWidth = 1;
      for (let i = 0; i < parts.length; i++) {
        for (let j = i + 1; j < parts.length; j++) {
          const dx = parts[i].x - parts[j].x; const dy = parts[i].y - parts[j].y;
          const d2 = dx * dx + dy * dy;
          if (d2 < 16900) {
            const o = (1 - Math.sqrt(d2) / 130) * 0.09;
            ctx.strokeStyle = "rgba(235,232,222," + o.toFixed(3) + ")";
            ctx.beginPath(); ctx.moveTo(parts[i].x, parts[i].y); ctx.lineTo(parts[j].x, parts[j].y); ctx.stroke();
          }
        }
      }
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.x < -8) p.x = W + 8; if (p.x > W + 8) p.x = -8;
        if (p.y < -8) p.y = H + 8; if (p.y > H + 8) p.y = -8;
        const tw = 0.7 + 0.3 * Math.sin(t * 0.5 + p.ph);
        ctx.fillStyle = "rgba(240,238,230," + (p.a * tw).toFixed(3) + ")";
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill();
      }
    };
    resize();
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    ro?.observe(wrap);
    if (reduced) { return () => { gone = true; ro?.disconnect(); }; }
    let last = 0;
    const step = (now: number) => {
      if (gone) return;
      if (inView && !document.hidden && now - last > 40) { draw(now); last = now; }
      raf = window.requestAnimationFrame(step);
    };
    const io = typeof IntersectionObserver !== "undefined"
      ? new IntersectionObserver((es) => { inView = es.some((e) => e.isIntersecting); }, { threshold: 0.05 })
      : null;
    if (io) io.observe(wrap); else inView = true;
    raf = window.requestAnimationFrame(step);
    return () => { gone = true; window.cancelAnimationFrame(raf); ro?.disconnect(); io?.disconnect(); };
  }, []);

  return (
    <section aria-label="A glimpse inside an ongoing mind">
      <div className="mx-auto max-w-6xl px-5 sm:px-8">
        <Reveal>
          <div ref={wrapRef} className="salpa-interlude relative h-[320px] overflow-hidden rounded-2xl border border-white/[0.08] md:h-[420px]">
            <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
            <div aria-hidden className="salpa-interlude-fallback absolute inset-0 hidden" />
            <div aria-hidden className="salpa-interlude-overlay absolute inset-0" />
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="max-w-md text-balance text-lg font-medium leading-relaxed tracking-tight text-white/90 md:text-xl">
                A glimpse inside an ongoing mind.
              </p>
            </div>
          </div>
        </Reveal>
        <p className="mt-4 text-center text-xs tracking-wide text-[#94a3b8]">
          Generative visualization — quiet by design. No footage, no spectacle.
        </p>
      </div>
      <div aria-hidden className="mx-auto mt-16 h-px max-w-6xl bg-white/[0.06] md:mt-24" />
    </section>
  );
}
