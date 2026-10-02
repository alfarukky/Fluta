import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ShowcaseSectionProps {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  className?: string;
}

export function ShowcaseSection({
  id,
  title,
  description,
  children,
  className,
}: ShowcaseSectionProps) {
  const headingId = `${id}-heading`;

  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn("scroll-mt-24 border-t border-border pt-section", className)}
    >
      <div className="mb-6 flex flex-col gap-1">
        <h2 id={headingId} className="type-h2">
          {title}
        </h2>
        <p className="type-body-sm max-w-2xl text-muted-foreground">
          {description}
        </p>
      </div>
      {children}
    </section>
  );
}

interface ShowcaseGroupProps {
  title: string;
  children: ReactNode;
  className?: string;
}

export function ShowcaseGroup({ title, children, className }: ShowcaseGroupProps) {
  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <h3 className="type-label text-muted-foreground">{title}</h3>
      {children}
    </div>
  );
}
