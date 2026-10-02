import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

// The custom typography utilities (globals.css) are font-size classes. Without
// this, tailwind-merge classifies `text-label` / `text-code` as text colors and
// silently drops them whenever a real color (text-foreground, …) appears in the
// same cn() call.
const twMerge = extendTailwindMerge({
  extend: { classGroups: { "font-size": ["text-label", "text-code"] } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
