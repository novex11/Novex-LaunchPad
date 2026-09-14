"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useReducedMotion, AnimatePresence } from "motion/react";
import { cn } from "@/lib/utils";
import { WatermarkNumber } from "./watermark-number";

export interface PipelineStep {
  index: string;
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
  /** Short mono status shown while the step is active, e.g. "signed · 0x3f…". */
  status?: string;
}

interface StepPipelineProps {
  steps: PipelineStep[];
  /** Milliseconds each step stays active while auto-playing. */
  dwellMs?: number;
}

/**
 * Six-step ledger grid that "runs": one step is active at a time, a
 * progress hairline fills across its top edge, then the next step lights up.
 * Hovering a step focuses it and pauses autoplay. Pauses off-screen.
 */
export function StepPipeline({ steps, dwellMs = 2600 }: StepPipelineProps) {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { amount: 0.35 });
  const [active, setActive] = useState(0);
  const [hovered, setHovered] = useState<number | null>(null);
  const playing = inView && hovered === null && !reduced;
  const current = hovered ?? active;

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setActive((a) => (a + 1) % steps.length), dwellMs);
    return () => clearInterval(id);
  }, [playing, dwellMs, steps.length]);

  return (
    <div
      ref={ref}
      className="grid grid-cols-1 divide-y divide-border border-b border-border md:grid-cols-3 md:divide-x md:divide-y-0 lg:grid-cols-6"
      onMouseLeave={() => setHovered(null)}
    >
      {steps.map((s, i) => {
        const isActive = current === i;
        const done = !reduced && hovered === null && i < active;
        return (
          <motion.div
            key={s.index}
            onMouseEnter={() => setHovered(i)}
            onFocus={() => setHovered(i)}
            tabIndex={0}
            initial={reduced ? false : { opacity: 0, y: 14 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-10% 0px" }}
            transition={{ duration: 0.5, delay: i * 0.06, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "ledger-cell group relative flex min-h-[220px] flex-col cursor-default border-border outline-none transition-colors duration-500",
              isActive ? "bg-surface-muted" : "bg-surface",
            )}
          >
            {/* Progress hairline along the top edge */}
            <span aria-hidden className="absolute inset-x-0 top-0 h-px bg-border-subtle" />
            <motion.span
              aria-hidden
              className="absolute left-0 top-0 h-px origin-left bg-accent"
              initial={false}
              animate={{
                scaleX: isActive ? 1 : done ? 1 : 0,
                opacity: isActive || done ? 1 : 0,
              }}
              transition={
                isActive && playing
                  ? { scaleX: { duration: dwellMs / 1000, ease: "linear" }, opacity: { duration: 0.2 } }
                  : { duration: 0.35 }
              }
              style={{ width: "100%" }}
            />

            <WatermarkNumber n={s.index} />

            <div className="relative flex items-center gap-2">
              <motion.span
                className={cn(
                  "flex h-7 w-7 items-center justify-center border transition-colors duration-500",
                  isActive ? "border-accent bg-accent text-accent-foreground" : "border-border text-accent",
                )}
                animate={isActive && !reduced ? { scale: [1, 1.08, 1] } : { scale: 1 }}
                transition={{ duration: 0.5 }}
              >
                {s.icon}
              </motion.span>
              <span className={cn("font-mono text-xs transition-colors", isActive ? "text-foreground" : "text-accent")}>
                {s.index}
              </span>
              <span
                aria-hidden
                className={cn(
                  "ml-auto h-1.5 w-1.5 transition-colors duration-500",
                  isActive ? "bg-accent" : done ? "bg-accent opacity-50" : "bg-border",
                )}
              />
            </div>

            <h3 className={cn("relative mt-4 text-base font-medium transition-colors", isActive ? "text-foreground" : "text-foreground/90")}>
              {s.title}
            </h3>
            <div className="relative mt-2 text-sm leading-relaxed text-muted-foreground">{s.body}</div>

            {/* Fixed-height slot so the grid never reflows when a chip appears */}
            <div className="relative mt-auto h-7 pt-3">
              <AnimatePresence>
                {isActive && s.status && (
                  <motion.p
                    key="status"
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    transition={{ duration: 0.25 }}
                    className="inline-flex max-w-full items-center gap-2 truncate border border-border bg-background px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-accent"
                  >
                    <span className="h-1 w-1 shrink-0 bg-accent" />
                    <span className="truncate">{s.status}</span>
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
}
