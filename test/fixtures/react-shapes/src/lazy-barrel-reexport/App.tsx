import { lazy } from "react";

// Mix of static + lazy imports through the same barrel — both
// resolve to the canonical source rather than the barrel.
import HomeStatic from "./pages/home";
import { Settings as SettingsStatic } from "./pages/home";

const HomeLazy = lazy(() => import("./pages/home"));
const SettingsLazy = lazy(() => import("./pages/home").then((m) => m.Settings));

export function App() {
  return (
    <>
      <HomeStatic />
      <SettingsStatic />
      <HomeLazy />
      <SettingsLazy />
    </>
  );
}
