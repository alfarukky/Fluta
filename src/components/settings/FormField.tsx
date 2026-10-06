import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";

interface FormFieldProps {
  id: string;
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

// Label, hint, control, and error message. The control should set
// aria-describedby={describedBy(id, hint, error)} and aria-invalid.
export function FormField({ id, label, hint, error, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-col gap-1">
        <Label htmlFor={id} className="type-label text-foreground">
          {label}
        </Label>
        {hint && (
          <p id={`${id}-hint`} className="type-caption text-muted-foreground">
            {hint}
          </p>
        )}
      </div>
      {children}
      {error && (
        <p id={`${id}-error`} className="type-caption text-error">
          {error}
        </p>
      )}
    </div>
  );
}

export function describedBy(id: string, hint?: string, error?: string): string | undefined {
  return [hint && `${id}-hint`, error && `${id}-error`].filter(Boolean).join(" ") || undefined;
}
