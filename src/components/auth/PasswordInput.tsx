"use client";

import { useState, type ComponentProps } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

// A password field with a Show/Hide toggle.
export function PasswordInput(props: Omit<ComponentProps<typeof Input>, "type">) {
  const [shown, setShown] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={shown ? "text" : "password"} className="pr-16" />
      <Button
        type="button"
        variant="ghost"
        className="absolute inset-y-0 right-0 h-11 px-4 text-xs text-muted-foreground hover:bg-transparent"
        aria-label={shown ? "Hide password" : "Show password"}
        aria-pressed={shown}
        onClick={() => setShown((value) => !value)}
      >
        {shown ? "Hide" : "Show"}
      </Button>
    </div>
  );
}
