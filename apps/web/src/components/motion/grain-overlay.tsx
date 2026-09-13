/**
 * Fixed, pointer-events-none film grain. Lives outside every scrolling
 * container so it never triggers repaints while scrolling.
 */
export function GrainOverlay() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-[1] mix-blend-multiply"
      style={{
        opacity: "var(--grain-opacity)",
        backgroundImage:
          "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='160' height='160'><filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='3' stitchTiles='stitch'/></filter><rect width='100%' height='100%' filter='url(%23n)'/></svg>\")",
        backgroundSize: "160px 160px",
      }}
    />
  );
}
