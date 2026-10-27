import * as React from "react";
import { Plus, Square } from "lucide-react";
import { cn } from "@/shared/lib/utils";

/* Where you ask the assistant for something: a note above it, the files it
   will read, the words, then the tools. Enter sends; Shift and Enter make a
   new line; a half-typed character in an input method never sends. While it
   answers, Send becomes Stop. Below md every control is a fingertip and
   the words are in the body type, as on the prototype's phone. */

type ComposerContextValue = {
  busy: boolean;
  empty: boolean;
  setEmpty: (empty: boolean) => void;
  onStop?: () => void;
};
const ComposerContext = React.createContext<ComposerContextValue>({
  busy: false,
  empty: true,
  setEmpty: () => {},
});

function Composer({
  className,
  busy = false,
  onStop,
  onSubmit,
  ...props
}: React.ComponentProps<"form"> & { busy?: boolean; onStop?: () => void }) {
  const [empty, setEmpty] = React.useState(true);
  return (
    <ComposerContext.Provider value={{ busy, empty, setEmpty, onStop }}>
      <form
        data-slot="composer"
        data-busy={busy || undefined}
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy && !empty) onSubmit?.(e);
        }}
        className={cn(
          "group/composer @container/composer flex w-full min-w-0 flex-col rounded-2xl border border-border bg-surface-panel shadow-composer transition-[border-color,box-shadow] duration-150 hover:border-muted-foreground/20 focus-within:border-primary/45 focus-within:ring-3 focus-within:ring-primary/12",
          className
        )}
        {...props}
      />
    </ComposerContext.Provider>
  );
}

/* A line over the box: what the assistant is set to, or why it cannot answer */
function ComposerBanner({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-banner"
      className={cn(
        "flex items-center gap-2 rounded-t-[15px] border-b border-border bg-white/[0.03] px-3.5 py-2 text-xs text-muted-foreground max-md:text-control max-md:font-read",
        className
      )}
      {...props}
    />
  );
}

/* The files and selections it will read */
function ComposerContextList({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-context"
      className={cn("flex flex-wrap gap-1.5 px-3 pt-3", className)}
      {...props}
    />
  );
}

function ComposerChip({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="composer-chip"
      className={cn(
        "inline-flex h-[22px] items-center gap-1.5 rounded-full border border-border px-2 py-px text-xs text-muted-foreground [&_svg]:size-3.5",
        className
      )}
      {...props}
    />
  );
}

function ComposerInput({
  className,
  onKeyDown,
  onInput,
  value,
  ...props
}: React.ComponentProps<"textarea">) {
  const { setEmpty } = React.useContext(ComposerContext);
  const ref = React.useRef<HTMLTextAreaElement>(null);
  // The width the height was last measured at; null until it first is
  const measuredAt = React.useRef<number | null>(null);
  const grow = React.useCallback(
    (el: HTMLTextAreaElement) => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
      measuredAt.current = el.clientWidth;
      setEmpty(!el.value.trim());
    },
    [setEmpty]
  );
  // A controlled value can change without an input event (a prompt the
  // product puts in, a send that clears it), so emptiness follows it too.
  React.useLayoutEffect(() => {
    if (value === undefined || !ref.current) return;
    grow(ref.current);
  }, [value, grow]);
  // The height follows the width too. An input measured in a narrow column
  // (a panel that mounts it while still folded, then opens) wraps its
  // placeholder per character and would keep that height once the column
  // grows. Only a width other than the measured one re-grows, so the height
  // this sets never feeds back into the observer; its first call, on
  // observe, catches a width that changed before this effect ran.
  React.useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (measuredAt.current === null || measuredAt.current === el.clientWidth)
        return;
      grow(el);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [grow]);
  return (
    <textarea
      ref={ref}
      value={value}
      data-slot="composer-input"
      rows={1}
      aria-label="Message"
      onInput={(e) => {
        grow(e.currentTarget);
        onInput?.(e);
      }}
      onKeyDown={(e) => {
        onKeyDown?.(e);
        if (e.defaultPrevented) return;
        if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
          e.preventDefault();
          e.currentTarget.form?.requestSubmit();
        }
      }}
      className={cn(
        "max-h-[200px] min-h-11 w-full resize-none bg-transparent px-[1.125rem] pt-[1.125rem] pb-0 text-[0.9375rem] leading-normal font-[350] text-foreground outline-none placeholder:text-subtle max-md:min-h-12 max-md:text-body max-md:font-read",
        className
      )}
      {...props}
    />
  );
}

function ComposerToolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="composer-toolbar"
      className={cn("flex items-center gap-1.5 px-3 pt-1.5 pb-2.5", className)}
      {...props}
    />
  );
}

/* Add a file, a selection, a program */
function ComposerAdd({ className, ...props }: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="composer-add"
      aria-label="Add context"
      className={cn(
        "grid size-8 shrink-0 place-items-center rounded-full text-muted-foreground transition-colors outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring max-md:size-12",
        className
      )}
      {...props}
    >
      <Plus className="size-4" />
    </button>
  );
}

/* The model you are talking to, named in the box and never hidden in settings */
function ComposerModel({
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      data-slot="composer-model"
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-act text-muted-foreground transition-colors outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring [&_svg]:size-3.5",
        className
      )}
      {...props}
    />
  );
}

/* How hard it thinks: a ring filled to the level. The word hides when the
   box is narrow, the ring never does. */
function ComposerEffort({
  className,
  value,
  max = 3,
  label = "Effort",
  ...props
}: React.ComponentProps<"button"> & {
  value: number;
  max?: number;
  label?: string;
}) {
  const r = 6;
  const c = 2 * Math.PI * r;
  return (
    <button
      type="button"
      data-slot="composer-effort"
      aria-label={`${label}: ${value} of ${max}`}
      className={cn(
        "inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-act text-muted-foreground transition-colors outline-none hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className
      )}
      {...props}
    >
      <svg viewBox="0 0 16 16" className="size-4 -rotate-90" aria-hidden="true">
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.25"
          strokeWidth="2"
        />
        <circle
          cx="8"
          cy="8"
          r={r}
          fill="none"
          stroke="var(--brand-purple)"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={`${(c * value) / max} ${c}`}
        />
      </svg>
      <span className="hidden @[300px]/composer:inline">{label}</span>
    </button>
  );
}

function ComposerSend({
  className,
  children,
  ...props
}: React.ComponentProps<"button">) {
  const { busy, empty, onStop } = React.useContext(ComposerContext);
  if (busy) {
    return (
      <button
        type="button"
        data-slot="composer-stop"
        aria-label="Stop"
        onClick={onStop}
        className={cn(
          "ml-auto grid size-8 shrink-0 place-items-center rounded-full bg-foreground text-background transition-transform outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 max-md:size-12",
          className
        )}
      >
        <Square className="size-3 fill-current" />
      </button>
    );
  }
  return (
    <button
      type="submit"
      data-slot="composer-send"
      aria-label="Send"
      disabled={empty}
      className={cn(
        "brand-action ml-auto grid size-8 shrink-0 place-items-center rounded-full text-foreground hover:not-disabled:not-aria-disabled:text-white active:not-disabled:not-aria-disabled:text-white [--stroke-fill:var(--surface-hover)] transition-[opacity,transform] outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-95 disabled:opacity-35 [&_svg]:size-4 max-md:size-12 max-md:[&_svg]:size-5",
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export {
  Composer,
  ComposerAdd,
  ComposerBanner,
  ComposerChip,
  ComposerContextList,
  ComposerEffort,
  ComposerInput,
  ComposerModel,
  ComposerSend,
  ComposerToolbar,
};
