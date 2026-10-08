import { cn } from "@/lib/utils";

// A form-level message: an error (role="alert") or a confirmation.
export function FormAlert({ tone = "error", children }: { tone?: "error" | "success"; children: string }) {
  return (
    <p
      role={tone === "error" ? "alert" : "status"}
      className={cn(
        "type-body-sm rounded-lg border px-3.5 py-3",
        tone === "error" ? "border-error/30 bg-error/10 text-error" : "border-success/30 bg-success/10 text-success",
      )}
    >
      {children}
    </p>
  );
}
