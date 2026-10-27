import { lazy, ReactNode, Suspense } from "react";

import { ThemeProvider } from "../providers/theme";
import { AppLoading } from "../components/Loading/App";
import { TooltipProvider } from "@/shared/ui/tooltip";

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

// Every tooltip in the app waits this long before it opens, so a pointer
// passing over a toolbar does not light up each button in turn. The one
// provider is also what the design system's `Tooltip` expects: the
// navigation's rail items (`SidebarMenuButton`'s `tooltip`) throw without it.
const TOOLTIP_DELAY_MS = 500;

// The providers inside `ThemeProvider` that need no theme of their own, apart
// so a test can render a component under exactly what the app gives it
// (`shared-ui.test.tsx`) without creating a theme.
export const AppProviders = ({ children }: { children: ReactNode }) => (
  <TooltipProvider delayDuration={TOOLTIP_DELAY_MS}>{children}</TooltipProvider>
);

const App = () => (
  <ThemeProvider>
    <AppProviders>
      <Suspense fallback={<AppLoading />}>
        <AppLazy />
      </Suspense>
    </AppProviders>
  </ThemeProvider>
);

export default App;
