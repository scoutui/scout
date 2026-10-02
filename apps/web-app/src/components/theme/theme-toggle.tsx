"use client";

import * as React from "react";
import { Monitor, Moon, Sun } from "lucide-react";

import { useTheme, type Theme } from "@/components/theme/theme-provider";

// One button cycles system → light → dark and shows the icon of the current
// setting.
const ORDER: Theme[] = ["system", "light", "dark"];
const META: Record<Theme, { Icon: typeof Monitor; label: string }> = {
  system: { Icon: Monitor, label: "System theme" },
  light: { Icon: Sun, label: "Light theme" },
  dark: { Icon: Moon, label: "Dark theme" },
};

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  // The theme is only known on the client, so the icon waits for mount to keep
  // SSR and the first client render in agreement. The colours are already
  // right before paint (the layout's inline script).
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const shown: Theme = mounted ? theme : "system";
  const { Icon, label } = META[shown];
  const next = ORDER[(ORDER.indexOf(shown) + 1) % ORDER.length] ?? "system";

  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      aria-label={`${label} (switch to ${META[next].label.toLowerCase()})`}
      title={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 [&_svg]:size-4"
    >
      <Icon aria-hidden />
    </button>
  );
}
