import { cn } from "@/lib/utils"

import { install, SITE } from "./site"

type Row = {
  /** what it is in client-v2 today */
  now: string
  /** what it becomes */
  next: string
  /** what of ours is kept on the way */
  keep: string
  state: "built" | "stock" | "planned"
}

const STOCK: Row[] = [
  { now: "Checkbox", next: "Checkbox and Label", keep: "The label brightens when checked. A 48 px target on a phone.", state: "stock" },
  { now: "Foldable", next: "Collapsible", keep: "The chevron turns 90°.", state: "stock" },
  { now: "ProgressBar", next: "Progress", keep: "No edge at zero. The fill moves in 250 ms.", state: "stock" },
  { now: "Select (react-select)", next: "Select", keep: "Option groups. A tick before the chosen one.", state: "stock" },
  { now: "Skeleton, Spinner", next: "Skeleton, Spinner", keep: "The shimmer between the two raised greys.", state: "stock" },
  { now: "Toast (react-toastify)", next: "Sonner", keep: "Bottom left, clear of the rail. The accent progress bar comes back as a custom toast.", state: "planned" },
  { now: "Link", next: "a, or Button as link", keep: "An outside link opens a new tab and shows the icon.", state: "stock" },
  { now: "Deploy chip", next: "Badge, outline", keep: "Round, in the code face, lower case.", state: "stock" },
  { now: "Interact select", next: "NativeSelect", keep: "The code face.", state: "stock" },
]

const OURS: Row[] = [
  { now: "Button, every kind", next: "Button, BrandButton, AsyncButton, CopyButton", keep: "The brand ring, the flat accent, waiting on its own promise, Copy turning to Copied.", state: "built" },
  { now: "Card that opens", next: "ActionCard, frame", keep: "The ring of brand colours on hover, and the lift.", state: "built" },
  { now: "Input with a validator", next: "Field and FieldError", keep: "The message above the field, a success edge.", state: "planned" },
  { now: "SearchBar", next: "Command inside a Popover", keep: "Drill-down pages, paste to pick, the last value restored.", state: "planned" },
  { now: "Text (callout)", next: "Callout", keep: "Five kinds, each with its tint and icon.", state: "built" },
  { now: "Tag", next: "Tag", keep: "The level colours. Framework and language icons.", state: "built" },
  { now: "Four menus", next: "DropdownMenu and ContextMenu, with Menu extras. Drawer on a phone", keep: "Lines under names, key hints, rows that fold open, notes.", state: "built" },
  { now: "Popover, Tooltip", next: "Tooltip, Popover, HoverCard, HelpTip", keep: "The 500 ms delay. The question-mark help.", state: "built" },
  { now: "Modal", next: "Modal", keep: "A page of its own on a phone, with a 60 px bar and a pinned foot. The wide size.", state: "built" },
  { now: "Resizable, Sash", next: "Resizable", keep: "The accent line that shows after 0.15 s of hover.", state: "stock" },
  { now: "Stepper", next: "Stepper", keep: "The sliding gradient thumb, the statuses, the target, compact.", state: "built" },
  { now: "Switches and choices", next: "Segmented", keep: "The thumb, boxed tabs with a count, the gradient choice, chips.", state: "built" },
  { now: "NavSidebar", next: "Sidebar, folding to icons", keep: "14.5 rem open, 3.25 rem as a rail, ⌘B.", state: "stock" },
  { now: "ProjectList, ProjectSwitcher", next: "Sidebar menu items, DropdownMenu", keep: "Pins, rename in place, lesson progress, letter shortcuts.", state: "planned" },
  { now: "Reader", next: "Dialog, not modal, inside the stage", keep: "Focus goes back where it was. Esc closes.", state: "stock" },
  { now: "Gallery card", next: "ActionCard", keep: "Media, eyebrow, clamped lines. The whole card is the target on a phone.", state: "built" },
  { now: "EmptyStage", next: "StageEmpty", keep: "The meta line, the notice, actions pinned on a phone.", state: "built" },
]

const ONLY: Row[] = [
  { now: "Composer", next: "Composer", keep: "Banner, context chips, the effort ring, Send turning to Stop.", state: "built" },
  { now: "ConsoleDrawer", next: "ConsoleDrawer", keep: "Folds by height so the terminal stays mounted. ⌘J.", state: "built" },
  { now: "SetupChecklist", next: "SetupList", keep: "The count in the title, dismiss on hover, the green tick.", state: "built" },
  { now: "ObjectiveBand", next: "ObjectiveBand", keep: "The gradient meter, back and on, the hint that escalates.", state: "built" },
  { now: "LessonBar, on a phone", next: "ObjectiveBand's actions, at the foot", keep: "A 60 px frosted bar.", state: "planned" },
  { now: "StepRail", next: "StepRail", keep: "Done, skipped, current and locked, each with its mark.", state: "built" },
  { now: "Build and Deploy stages", next: "Diagnostic, Deploy result, Table", keep: "The faulty line marked. One accent action per screen.", state: "built" },
  { now: "Session footer", next: "Session footer block", keep: "The cluster row and the account row.", state: "built" },
  { now: "Editor tabs", next: "EditorTabs", keep: "The purple top line. Close on hover. Reorder stays with dnd-kit.", state: "built" },
  { now: "CodeBlock, Terminal", next: "CodeBlock, Terminal", keep: "The syntax colours, the green caret. xterm stays the engine.", state: "built" },
  { now: "UploadArea", next: "DropZone", keep: "The dashed purple edge. It is also a button.", state: "built" },
  { now: "Wallet window", next: "A floating panel, a Sheet on a phone", keep: "Dragging, the purple glow at its head.", state: "planned" },
  { now: "PlayRing, marks, loaders", next: "Logo, BrandButtonIcon, Spinner", keep: "The mark takes its text's colour.", state: "built" },
]

const STATE_LABEL = { built: "In v0", stock: "Stock shadcn", planned: "Planned" }

function Rows({ rows }: { rows: Row[] }) {
  return (
    <div className="divide-y divide-border rounded-card border border-border">
      <div className="hidden gap-6 px-5 py-3 text-caption font-label text-subtle md:grid md:grid-cols-[1fr_1.2fr_1.6fr_7rem]">
        <span>In client-v2</span>
        <span>In the system</span>
        <span>What is kept</span>
        <span>State</span>
      </div>
      {rows.map((r) => (
        <div key={r.now} className="grid gap-1 px-5 py-3.5 md:grid-cols-[1fr_1.2fr_1.6fr_7rem] md:gap-6">
          <span className="text-control font-act text-foreground">{r.now}</span>
          <span className="text-caption font-read text-foreground">{r.next}</span>
          <span className="text-caption font-read text-muted-foreground">{r.keep}</span>
          <span
            className={cn(
              "text-caption font-label",
              r.state === "built" && "text-success",
              r.state === "stock" && "text-muted-foreground",
              r.state === "planned" && "text-warning"
            )}
          >
            {STATE_LABEL[r.state]}
          </span>
        </div>
      ))}
    </div>
  )
}

function Steps() {
  const steps = [
    ["Upgrade React.", "Today's shadcn passes a ref as a plain prop, which React 17 drops. Go to 19 first, with react-dom and the types. CRA runs on it; Vite can come later."],
    ["Add Tailwind 4 beside styled-components.", "It goes in through PostCSS in craco, without its reset at first, so nothing on screen moves. Load tokens.css and theme.css and put dark on the html element."],
    ["Install from our registry.", `The tokens first, then each component as it is needed. Stock ones come from shadcn by name.`],
    ["Move one piece at a time, leaves first.", "Tag, Callout, StatusDot and the buttons. Then Stepper, Segmented and the menus. The panels last. Each move deletes one styled-component."],
    ["Keep the ids and the labels.", "Studio's map and the tests find things by them, so they stay exactly as they are."],
    ["Turn the reset on last.", "When the last global style has gone, Tailwind's preflight can come in, and the two systems become one."],
  ]
  return (
    <ol className="grid gap-px overflow-hidden rounded-card border border-border bg-border md:grid-cols-2">
      {steps.map(([title, body]) => (
        <li key={title} className="bg-background p-5">
          <div className="text-control font-act text-foreground">{title}</div>
          <p className="mt-1 text-caption font-read text-muted-foreground">{body}</p>
        </li>
      ))}
    </ol>
  )
}

function Migration() {
  return (
    <div className="flex flex-col gap-10">
      <div>
        <h4 className="font-heading text-2xl font-headline tracking-tight text-foreground">The steps</h4>
        <p className="mt-2 max-w-2xl text-body font-read text-muted-foreground">
          The tokens go in first and the components follow, so the product never breaks in between.
        </p>
        <div className="mt-6">
          <Steps />
        </div>
        <div className="mt-4 flex flex-col gap-2 rounded-card border border-border p-5">
          <span className="text-caption font-label text-subtle">Install the tokens, then any of ours</span>
          <code className="font-mono text-[12px] break-all text-foreground">{install("playground-tokens")}</code>
          <code className="font-mono text-[12px] break-all text-foreground">{install("stepper")}</code>
          <span className="text-caption font-read text-muted-foreground">
            Everything the registry holds is listed at{" "}
            <a className="text-foreground underline underline-offset-3" href={`${SITE}/r/registry.json`}>
              /r/registry.json
            </a>
            .
          </span>
        </div>
      </div>

      <div>
        <h4 className="font-heading text-2xl font-headline tracking-tight text-foreground">Stock shadcn, restyled by tokens</h4>
        <p className="mt-2 max-w-2xl text-body font-read text-muted-foreground">
          These are shadcn as it ships. The tokens carry our look. What little is ours is a class at the place it is used.
        </p>
        <div className="mt-6">
          <Rows rows={STOCK} />
        </div>
      </div>

      <div>
        <h4 className="font-heading text-2xl font-headline tracking-tight text-foreground">Where ours does more</h4>
        <p className="mt-2 max-w-2xl text-body font-read text-muted-foreground">
          shadcn has one, but ours does something it does not. We keep ours, written the way shadcn writes its own. The stock file stays untouched, so shadcn can still update it.
        </p>
        <div className="mt-6">
          <Rows rows={OURS} />
        </div>
      </div>

      <div>
        <h4 className="font-heading text-2xl font-headline tracking-tight text-foreground">Only in Playground</h4>
        <p className="mt-2 max-w-2xl text-body font-read text-muted-foreground">No shadcn equivalent. These are ours outright, in the same structure.</p>
        <div className="mt-6">
          <Rows rows={ONLY} />
        </div>
      </div>

      <div>
        <h4 className="font-heading text-2xl font-headline tracking-tight text-foreground">Patterns that became tokens</h4>
        <div className="mt-6 grid gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-2 lg:grid-cols-3">
          {[
            ["frosted", "The bars over the stage: 82% of the ground, blurred 18 px."],
            ["gradient-stroke", "A 1 px ring of Solana's two colours round any fill."],
            ["brand-action", "That ring, filling with the gradient on hover."],
            ["--gradient-product", "Solana's purple into green, at 120° and flat."],
            ["--surface-well", "The terminal's ground, one step below the stage."],
            ["ease-standard", "The product's one curve, cubic-bezier(0.2, 0, 0, 1)."],
            ["h-target", "48 px, every touch target on a phone."],
            ["h-phone-bar", "60 px, a phone's top and bottom bars."],
            ["animate-pulse-dot", "Running, as a dot that breathes."],
          ].map(([name, what]) => (
            <div key={name} className="bg-background p-5">
              <code className="font-mono text-caption text-foreground">{name}</code>
              <p className="mt-1 text-caption font-read text-muted-foreground">{what}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export { Migration }
