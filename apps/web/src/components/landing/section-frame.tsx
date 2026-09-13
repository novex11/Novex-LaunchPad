import { cn } from "@/lib/utils";
import { MonoLabel } from "./mono-label";

interface SectionFrameProps {
  index: string;
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
  className?: string;
  id?: string;
}

/** Accrued-style section header: mono index, statement h2 left, paragraph right. */
export function SectionFrame({
  index,
  eyebrow,
  title,
  description,
  children,
  className,
  id,
}: SectionFrameProps) {
  return (
    <section id={id} className={cn("border-b border-border", className)}>
      <div className="grid gap-6 border-b border-border px-4 py-10 md:grid-cols-12 md:px-8 md:py-14">
        <div className="md:col-span-7">
          <MonoLabel index={index}>{eyebrow}</MonoLabel>
          <h2 className="statement-2 mt-4 text-foreground">{title}</h2>
        </div>
        {description && (
          <p className="text-sm leading-relaxed text-muted-foreground md:col-span-5 md:self-end md:text-base">
            {description}
          </p>
        )}
      </div>
      {children}
    </section>
  );
}
