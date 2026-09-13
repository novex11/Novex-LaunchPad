export function WatermarkNumber({ n }: { n: string }) {
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute right-4 top-4 select-none font-mono text-[3.5rem] font-medium leading-none text-foreground opacity-[0.07] md:text-[4.5rem]"
    >
      {n}
    </span>
  );
}
