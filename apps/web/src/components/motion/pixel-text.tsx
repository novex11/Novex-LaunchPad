"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

interface PixelTextProps {
  lines: string[];
  className?: string;
  /** Starting block size in CSS px for the mount reveal. */
  fromPx?: number;
  /** Mount reveal duration in ms. */
  duration?: number;
  as?: "h1" | "h2" | "p";
}

/**
 * Renders text that resolves from coarse pixel blocks into crisp type.
 * The real DOM text is always present (SEO / a11y); a canvas overlays it
 * during the effect. Plays once on mount only.
 */
export function PixelText({
  lines,
  className,
  fromPx = 32,
  duration = 1800,
  as = "h1",
}: PixelTextProps) {
  const textRef = useRef<HTMLElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);
  const reduced = useReducedMotion();
  // Start hidden so crisp text never flashes before the reveal begins.
  const [animating, setAnimating] = useState(true);
  const Comp = as;

  const run = useCallback(
    (startPx: number, ms: number) => {
      const el = textRef.current;
      const canvas = canvasRef.current;
      if (!el || !canvas) { setAnimating(false); return; }

      const rect = el.getBoundingClientRect();
      const W = Math.ceil(rect.width);
      const H = Math.ceil(rect.height);
      if (W === 0 || H === 0) { setAnimating(false); return; }

      const cs = getComputedStyle(el);
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const fontSize = parseFloat(cs.fontSize);
      const lineHeight = parseFloat(cs.lineHeight) || fontSize * 1.02;
      const font = `${cs.fontWeight} ${fontSize}px ${cs.fontFamily}`;
      const color = cs.color;
      const letterSpacing = cs.letterSpacing;

      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext("2d");
      const off = document.createElement("canvas");
      const octx = off.getContext("2d");
      if (!ctx || !octx) { setAnimating(false); return; }

      cancelAnimationFrame(rafRef.current);
      setAnimating(true);
      const t0 = performance.now();

      const frame = (now: number) => {
        const t = Math.min(1, (now - t0) / ms);
        const eased = 1 - Math.pow(1 - t, 3);
        const px = Math.max(1, Math.round(startPx * (1 - eased)));

        const sw = Math.max(1, Math.ceil(W / px));
        const sh = Math.max(1, Math.ceil(H / px));
        off.width = sw;
        off.height = sh;
        octx.setTransform(1 / px, 0, 0, 1 / px, 0, 0);
        octx.font = font;
        octx.fillStyle = color;
        octx.textBaseline = "middle";
        if ("letterSpacing" in octx) {
          (octx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = letterSpacing;
        }
        lines.forEach((line, i) => {
          octx.fillText(line, 0, lineHeight * i + lineHeight / 2);
        });

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(off, 0, 0, sw, sh, 0, 0, canvas.width, canvas.height);

        if (t < 1 && px > 1) {
          rafRef.current = requestAnimationFrame(frame);
        } else {
          setAnimating(false);
        }
      };
      rafRef.current = requestAnimationFrame(frame);
    },
    [lines],
  );

  useEffect(() => {
    if (reduced) {
      setAnimating(false);
      return;
    }
    let cancelled = false;
    const ready = typeof document !== "undefined" && "fonts" in document ? document.fonts.ready : Promise.resolve();
    ready.then(() => {
      if (!cancelled) run(fromPx, duration);
    });
    return () => {
      cancelled = true;
      cancelAnimationFrame(rafRef.current);
    };
  }, [reduced, run, fromPx, duration]);

  return (
    <span className="relative block">
      <Comp
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ref={textRef as any}
        className={cn(className, animating && "invisible")}
      >
        {lines.map((line, i) => (
          <Fragment key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </Fragment>
        ))}
      </Comp>
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn("pointer-events-none absolute left-0 top-0", !animating && "hidden")}
      />
    </span>
  );
}
