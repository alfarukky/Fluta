import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  description?: string;
  // Buttons shown beside the title on wider screens, below it on mobile.
  actions?: ReactNode;
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-component md:flex-row md:items-end md:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className="type-h1 text-foreground">{title}</h1>
        {description && <p className="type-body text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap gap-component">{actions}</div>}
    </header>
  );
}
