import { lazy, Suspense } from "react";

import { TooltipProvider } from "@/shared/ui/tooltip";
import { ThemeProvider } from "../providers/theme";
import { AppLoading } from "../components/Loading/App";

// If we initialize globals here e.g.
//
// ```
// const AppLazy = lazy(async () => {
//   const { GLOBALS } = await import("../globals");
//   const { initAll } = await import("../utils");
//   await initAll(GLOBALS);
//
//   return import("./AppLazy");
// });
// ```
//
// It results in significantly more chunks to load before the suspense is over.
// For this reason, globals are getting initialized inside `AppLazy`, which
// allows us to have as little chunks as possible.
const AppLazy = lazy(() => import("./AppLazy"));

// One `TooltipProvider` for the whole app, as the design system's `Tooltip`
// expects: the navigation's rail items (`SidebarMenuButton`'s `tooltip`)
// throw without one.
const App = () => (
  <ThemeProvider>
    <TooltipProvider>
      <Suspense fallback={<AppLoading />}>
        <AppLazy />
      </Suspense>
    </TooltipProvider>
  </ThemeProvider>
);

export default App;
