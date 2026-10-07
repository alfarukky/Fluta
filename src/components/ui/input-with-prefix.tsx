import * as React from "react"
import { cn } from "cn"

// An Input with a fixed prefix inside its border (the ₦ sign, a link's
// domain). Same 44px height, text size, border, focus ring and invalid state
// as Input, so prefixed and plain fields line up in a form. Read-only fields
// use the muted background.
function InputWithPrefix({
  prefix,
  prefixClassName,
  className,
  readOnly,
  ...props
}: Omit<React.ComponentProps<"input">, "prefix"> & {
  prefix: React.ReactNode
  prefixClassName?: string
}) {
  return (
    <div
      data-slot="input-with-prefix"
      className={cn(
        "flex h-11 w-full min-w-0 items-stretch overflow-hidden rounded-lg border border-input bg-card transition-colors focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 has-aria-invalid:border-destructive has-aria-invalid:ring-3 has-aria-invalid:ring-destructive/20 has-disabled:cursor-not-allowed has-disabled:opacity-50 dark:bg-input/30 dark:has-aria-invalid:border-destructive/50 dark:has-aria-invalid:ring-destructive/40",
        readOnly && "bg-muted dark:bg-muted",
        className
      )}
    >
      <span
        className={cn(
          "flex shrink-0 items-center border-r border-input bg-muted px-3.5 text-base text-muted-foreground md:text-sm",
          prefixClassName
        )}
      >
        {prefix}
      </span>
      <input
        data-slot="input"
        readOnly={readOnly}
        className="min-w-0 flex-1 bg-transparent px-3.5 text-base text-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed md:text-sm"
        {...props}
      />
    </div>
  )
}

export { InputWithPrefix }
