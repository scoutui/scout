"use client"

import { Drawer as DrawerPrimitive } from "@base-ui/react/drawer"

import { cn } from "@/lib/utils"

function Drawer(props: DrawerPrimitive.Root.Props) {
  return <DrawerPrimitive.Root data-slot="drawer" {...props} />
}

const POPUP =
  "flex flex-col bg-card text-card-foreground shadow-lg outline-none transition-transform duration-200 ease-out motion-reduce:transition-none"

/**
 * A drawer's panel: `right` slides in under the top bar, up to 440px wide;
 * `bottom` rises from the bottom edge as a sheet, up to 576px wide, over a
 * scrim, with a grab handle. The sheet's handle stays put while its content
 * (and `className`) scrolls, and it can be swiped down to close.
 */
function DrawerContent({
  side = "right",
  className,
  children,
  ...props
}: DrawerPrimitive.Popup.Props & { side?: "right" | "bottom" }) {
  if (side === "right") {
    return (
      <DrawerPrimitive.Portal>
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            POPUP,
            "fixed top-(--top-bar-height) right-0 bottom-0 z-50 w-[min(440px,calc(100vw-1rem))] overflow-y-auto overscroll-contain border-l data-starting-style:[transform:translateX(100%)] data-ending-style:[transform:translateX(100%)]",
            className,
          )}
          {...props}
        >
          {children}
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Portal>
    )
  }
  return (
    <DrawerPrimitive.Portal>
      <DrawerPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/30 transition-opacity duration-200 data-starting-style:opacity-0 data-ending-style:opacity-0 motion-reduce:transition-none dark:bg-black/60" />
      <DrawerPrimitive.Viewport className="fixed inset-0 z-50 flex items-end justify-center">
        <DrawerPrimitive.Popup
          data-slot="drawer-content"
          className={cn(
            POPUP,
            "max-h-[85vh] w-full max-w-xl overflow-hidden rounded-t-2xl border-t [transform:translateY(var(--drawer-swipe-movement-y,0px))] data-starting-style:[transform:translateY(100%)] data-ending-style:[transform:translateY(100%)] sm:border-x",
          )}
          {...props}
        >
          <span aria-hidden className="mx-auto mt-2.5 h-1 w-9 shrink-0 rounded-full bg-border" />
          <DrawerPrimitive.Content className={cn("min-h-0 overflow-y-auto overscroll-contain", className)}>
            {children}
          </DrawerPrimitive.Content>
        </DrawerPrimitive.Popup>
      </DrawerPrimitive.Viewport>
    </DrawerPrimitive.Portal>
  )
}

const DrawerTitle = DrawerPrimitive.Title
const DrawerClose = DrawerPrimitive.Close

export { Drawer, DrawerClose, DrawerContent, DrawerTitle }
