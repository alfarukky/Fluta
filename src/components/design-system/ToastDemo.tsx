"use client";

import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export interface ToastSample {
  kind: "success" | "info" | "warning" | "error";
  label: string;
  title: string;
  description?: string;
}

interface ToastDemoProps {
  samples: ToastSample[];
}

// Sample text arrives as props from the server page, so none of it is bundled
// into client JavaScript (the showcase is development-only).
export function ToastDemo({ samples }: ToastDemoProps) {
  return (
    <div className="flex flex-wrap gap-component">
      {samples.map((sample) => (
        <Button
          key={sample.kind}
          variant="outline"
          onClick={() =>
            toast[sample.kind](sample.title, { description: sample.description })
          }
        >
          {sample.label}
        </Button>
      ))}
    </div>
  );
}
