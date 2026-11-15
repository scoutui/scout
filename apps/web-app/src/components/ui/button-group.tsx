import type * as React from "react"

import { cn } from "@/lib/utils"

function ButtonGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      role="group"
      data-slot="button-group"
      data-orientation="horizontal"
      className={cn(
        "flex w-fit items-stretch *:focus-visible:relative *:focus-visible:z-10 *:not-first:rounded-l-none *:not-first:border-l-0 *:not-last:rounded-r-none",
        className
      )}
      {...props}
    />
  )
}

export { ButtonGroup }
