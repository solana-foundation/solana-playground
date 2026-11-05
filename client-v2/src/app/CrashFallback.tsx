import { Button } from "@/shared/ui/button";

type CrashFallbackProps = {
  /** What the button does; the page's own reload unless a test passes one */
  reload?: () => void;
};

/**
 * What the app shows when a render throws past every boundary: Spec 08's
 * fallback (ANY-00) for the whole app. Nothing is left on screen to retry
 * from, so it offers a reload. The boundary that shows it sits outside every
 * provider, the theme's included, so it uses only what needs none: token
 * classes from `index.css` and the design system's `Button`. `dark` picks the
 * product's ground, so a crash is no white flash. Its layout waits on the
 * designers.
 */
export const CrashFallback = ({
  reload = () => window.location.reload(),
}: CrashFallbackProps) => (
  <main className="dark fixed inset-0 grid place-items-center bg-background p-4 font-sans text-foreground">
    <div role="alert" className="flex max-w-md flex-col items-start gap-3">
      <p>
        Playground stopped for a reason we can&apos;t name. Reload the page.
      </p>
      <Button variant="outline" onClick={reload}>
        Reload
      </Button>
    </div>
  </main>
);
