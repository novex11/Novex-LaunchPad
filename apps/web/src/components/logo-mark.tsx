import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

const MARK_URL = "/brand/compose-mark.png";

const maskStyle: CSSProperties = {
  WebkitMaskImage: `url(${MARK_URL})`,
  maskImage: `url(${MARK_URL})`,
  WebkitMaskRepeat: "no-repeat",
  maskRepeat: "no-repeat",
  WebkitMaskPosition: "center",
  maskPosition: "center",
  WebkitMaskSize: "contain",
  maskSize: "contain",
};

/** The Compose compass mark, painted in the current text colour so it follows the theme. */
export function LogoMark({ className, style }: { className?: string; style?: CSSProperties }) {
  return <span aria-hidden className={cn("inline-block shrink-0 bg-current", className)} style={{ ...maskStyle, ...style }} />;
}
