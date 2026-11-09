import type * as React from "react"
import { ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

/** A native select whose arrow sits inset from its end edge. `wrapperClassName` sizes the box around it, such as `w-full`. */
function NativeSelect({ className, wrapperClassName, ...props }: React.ComponentProps<"select"> & { wrapperClassName?: string }) {
  return (
    <span className={cn("relative inline-flex items-center", wrapperClassName)}>
      <select
        data-slot="native-select"
        className={cn(
          "h-8 w-full appearance-none rounded-lg border border-control bg-transparent ps-2.5 pe-8 text-base transition-colors disabled:opacity-50 sm:text-sm dark:bg-input/30",
          className
        )}
        {...props}
      />
      <ChevronDown aria-hidden className="pointer-events-none absolute end-2.5 size-3.5 text-muted-foreground" />
    </span>
  )
}

export { NativeSelect }
