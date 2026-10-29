import {
  BookOpen,
  CircleAlert,
  Coins,
  Copy,
  ExternalLink,
  FileCode2,
  FileJson,
  Hammer,
  Info,
  KeyRound,
  Plus,
  Rocket,
  Share2,
  Sparkles,
  Terminal as TerminalIcon,
  TriangleAlert,
  Trophy,
  Upload,
  Vote,
  Wallet,
} from "lucide-react"

import { Achievement, AchievementLabel, AchievementMedia } from "@/components/ui/achievement"
import {
  ActionCard,
  ActionCardAction,
  ActionCardContent,
  ActionCardDescription,
  ActionCardEyebrow,
  ActionCardLink,
  ActionCardMedia,
  ActionCardTitle,
} from "@/components/ui/action-card"
import { AsyncButton } from "@/components/ui/async-button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { BrandButton, BrandButtonIcon } from "@/components/ui/brand-button"
import { Button } from "@/components/ui/button"
import { Callout, CalloutDescription, CalloutTitle } from "@/components/ui/callout"
import { CodeBlock, CodeBlockActions, CodeBlockContent, CodeBlockHeader, CodeBlockLine, CodeBlockTitle } from "@/components/ui/code-block"
import {
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
} from "@/components/ui/composer"
import {
  ConsoleDrawer,
  ConsoleDrawerActions,
  ConsoleDrawerBar,
  ConsoleDrawerContent,
  ConsoleDrawerStatus,
} from "@/components/ui/console-drawer"
import { CopyButton } from "@/components/ui/copy-button"
import {
  Diagnostic,
  DiagnosticCode,
  DiagnosticDescription,
  DiagnosticFooter,
  DiagnosticHeader,
  DiagnosticLine,
  DiagnosticSource,
  DiagnosticTitle,
} from "@/components/ui/diagnostic"
import { Diff, DiffContent, DiffFooter, DiffHeader, DiffLine, DiffStat, DiffTitle } from "@/components/ui/diff"
import { DropZone, DropZoneDescription, DropZoneIcon, DropZoneTitle } from "@/components/ui/drop-zone"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { EditorTab, EditorTabClose, EditorTabLabel, EditorTabs, EditorTabTrigger } from "@/components/ui/editor-tabs"
import { Field, FieldContent, FieldDescription, FieldLabel } from "@/components/ui/field"
import { HelpTip } from "@/components/ui/help-tip"
import { Input } from "@/components/ui/input"
import { Kbd } from "@/components/ui/kbd"
import { Logo, LogoLockup, LogoMark, LogoText } from "@/components/ui/logo"
import { MenuFold, MenuFoldChevron, MenuFoldContent, MenuFoldTrigger, MenuItemDescription, MenuItemText, MenuNote } from "@/components/ui/menu-extras"
import {
  Merge,
  type MergeBand,
  MergeCount,
  MergeFold,
  MergeFooter,
  MergeFooterActions,
  MergeFooterShortcuts,
  MergeHunkAction,
  MergeHunkActions,
  MergeHunkBar,
  MergeHunkBarSide,
  MergeHunkGutter,
  mergeHunkOrder,
  mergeHunkVariants,
  type MergeHunkState,
  MergeNav,
  MergePane,
  MergePaneBody,
  MergePaneHeader,
  MergePanes,
  MergePaneTabs,
  MergeRibbon,
  MergeShowAll,
  MergeTitle,
  MergeToolbar,
} from "@/components/ui/merge"
import {
  Modal,
  ModalBody,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  ModalTrigger,
} from "@/components/ui/modal"
import {
  ObjectiveActions,
  ObjectiveBand,
  ObjectiveBar,
  ObjectiveCheck,
  ObjectiveCount,
  ObjectiveFold,
  ObjectiveMain,
  ObjectiveMeter,
  ObjectiveNav,
  ObjectivePrimary,
  ObjectiveQuiet,
  ObjectiveRow,
  ObjectiveText,
} from "@/components/ui/objective-band"
import { Progress } from "@/components/ui/progress"
import { Segmented, SegmentedCount, SegmentedItem } from "@/components/ui/segmented"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  SetupList,
  SetupListContent,
  SetupListDismiss,
  SetupListHeader,
  SetupListIndicator,
  SetupListItem,
  SetupListLabel,
  SetupListTrigger,
  SetupListValue,
} from "@/components/ui/setup-list"
import {
  StageEmpty,
  StageEmptyActions,
  StageEmptyDescription,
  StageEmptyFooter,
  StageEmptyMedia,
  StageEmptyMeta,
  StageEmptyTitle,
} from "@/components/ui/stage-empty"
import { StatusDot } from "@/components/ui/status-dot"
import { StepRail, StepRailIndicator, StepRailItem, StepRailMeta, StepRailTitle } from "@/components/ui/step-rail"
import { Stepper, StepperItem, StepperList } from "@/components/ui/stepper"
import { levelVariant, Tag } from "@/components/ui/tag"
import { Terminal, TerminalCaret, TerminalLine } from "@/components/ui/terminal"
import { cn } from "@/lib/utils"

import { Block, More } from "./parts"

/* ── a tiny highlighter, for the code specimens only ─────────────────── */

const KEYWORDS = new Set(["use", "pub", "fn", "mod", "let", "mut", "struct", "impl", "return", "self", "super"])
const TYPES = new Set(["Context", "Result", "Program", "Signer", "Account", "u64", "String", "Initialize", "Ok"])

const SYNTAX = {
  comment: "text-syntax-comment",
  keyword: "text-syntax-keyword",
  type: "text-syntax-type",
  number: "text-syntax-number",
  function: "text-syntax-function",
  string: "text-syntax-string",
}

/* The syntax colours are tuned for the product's dark ground; on paper the
   status inks stand in, so a specimen drawn in both reads in both */
const SYNTAX_BOTH = {
  comment: "text-muted-foreground dark:text-syntax-comment",
  keyword: "text-primary dark:text-syntax-keyword",
  type: "text-info dark:text-syntax-type",
  number: "text-primary dark:text-syntax-number",
  function: "text-success dark:text-syntax-function",
  string: "text-warning dark:text-syntax-string",
}

function highlight(line: string, palette: typeof SYNTAX = SYNTAX) {
  if (line.trim().startsWith("//")) return <span className={palette.comment}>{line}</span>
  const parts = line.split(/(\s+|[(){}<>;:,.!#[\]&'"]+)/)
  return parts.map((part, i) => {
    if (KEYWORDS.has(part)) return <span key={i} className={palette.keyword}>{part}</span>
    if (TYPES.has(part)) return <span key={i} className={palette.type}>{part}</span>
    if (/^\d+$/.test(part)) return <span key={i} className={palette.number}>{part}</span>
    if (/^[a-z_]+$/.test(part) && parts[i + 1]?.startsWith("(")) return <span key={i} className={palette.function}>{part}</span>
    if (/"$/.test(parts[i - 1] ?? "") && part && !/^"/.test(part)) return <span key={i} className={palette.string}>{part}</span>
    return <span key={i}>{part}</span>
  })
}

const SAMPLE = `use anchor_lang::prelude::*;

#[program]
pub mod hello_anchor {
    use super::*;
    // Say hello, then stop
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        msg!("Hello, Playground");
        Ok(())
    }
}`

const PROGRAM_ID = "7Hq5vRw1yJmZ9bX3cDfE8sLkT2nA4uPqWe6oGhK1Xk2P"

/* ── the merge specimen ───────────────────────────────────────────────────
   Static lines where the app mounts its editors. A row is a line in each
   pane, a spacer (null) where one side has fewer lines, or a fold. The
   ribbons' offsets are worked out from the rows, as the app works them out
   from its editors. */

type MergeCell = { text: string; state?: MergeHunkState; actions?: React.ReactNode } | null
type MergeRow = { fold: number } | { bar: true } | { left: MergeCell; result: MergeCell; right: MergeCell }

const LINE = 20
const FOLD = 24
const BAR = 44
const PAD = 4

const same = (text: string): MergeRow => ({ left: { text }, result: { text }, right: { text } })

function rowTop(rows: MergeRow[], index: number) {
  return PAD + rows.slice(0, index).reduce((y, row) => y + ("fold" in row ? FOLD : "bar" in row ? BAR : LINE), 0)
}

/* A band from `lines` rows at `index` on one side to `toLines` on the other */
function band(rows: MergeRow[], index: number, lines: number, toLines: number, state: MergeHunkState): MergeBand {
  const top = rowTop(rows, index)
  return { fromTop: top, fromBottom: top + lines * LINE, toTop: top, toBottom: top + toLines * LINE, state }
}

/* A side's pair, mirrored about the result: × » on the left, « × on the right */
const hunkPair = (from: "left" | "right") =>
  mergeHunkOrder[from].map((action) => (
    <MergeHunkAction key={`${from}-${action}`} action={action} from={from} hunk="conflict 1 of 1" />
  ))

const TAKE_LEFT = (
  <MergeHunkActions hunk="conflict 1 of 1" state="conflict">
    {hunkPair("left")}
  </MergeHunkActions>
)

const TAKE_RIGHT = (
  <MergeHunkActions hunk="conflict 1 of 1" state="conflict">
    {hunkPair("right")}
  </MergeHunkActions>
)

/* At phone width the result carries both sides' controls, in a row under the hunk */
const HUNK_BAR = (
  <MergeHunkBar hunk="conflict 1 of 1" state="conflict">
    <MergeHunkBarSide side="left">{hunkPair("left")}</MergeHunkBarSide>
    <MergeHunkBarSide side="right">{hunkPair("right")}</MergeHunkBarSide>
  </MergeHunkBar>
)

function conflictRows(phone = false): MergeRow[] {
  return [
    same("use anchor_lang::prelude::*;"),
    same(""),
    {
      left: { text: 'declare_id!("Fg6P…sLnS");' },
      result: { text: 'declare_id!("7Hq5…Xk2P");', state: "changed" },
      right: { text: 'declare_id!("7Hq5…Xk2P");', state: "changed" },
    },
    same(""),
    { fold: 24 },
    same("#[program]"),
    same("pub mod hello_anchor {"),
    same("    use super::*;"),
    same("    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {"),
    {
      left: { text: '        msg!("Hi");', state: "conflict", actions: TAKE_LEFT },
      result: { text: '        msg!("Greetings");', state: "conflict" },
      right: { text: '        msg!("Hello");', state: "conflict", actions: TAKE_RIGHT },
    },
    { left: null, result: null, right: { text: '        msg!("Welcome back");', state: "conflict" } },
    ...(phone ? [{ bar: true } as const] : []),
    same("        Ok(())"),
    same("    }"),
    same("}"),
  ]
}

const CONFLICT_ROWS = conflictRows()
const CONFLICT_LEFT = [band(CONFLICT_ROWS, 9, 1, 1, "conflict")]
const CONFLICT_RIGHT = [band(CONFLICT_ROWS, 2, 1, 1, "changed"), band(CONFLICT_ROWS, 9, 1, 2, "conflict")]

/* The same hunk, decided: this device's line taken, the other's dismissed */
const DECIDED_ROWS: MergeRow[] = [
  same("    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {"),
  {
    left: { text: '        msg!("Hi");', state: "resolved" },
    result: { text: '        msg!("Hi");', state: "resolved" },
    right: { text: '        msg!("Hello");', state: "dismissed" },
  },
  { left: null, result: null, right: { text: '        msg!("Welcome back");', state: "dismissed" } },
  same("        Ok(())"),
  same("    }"),
]
const DECIDED_LEFT = [band(DECIDED_ROWS, 1, 1, 1, "resolved")]
const DECIDED_RIGHT = [band(DECIDED_ROWS, 1, 1, 2, "dismissed")]

/* A file the other device deleted and this one edited: the whole file is
   one hunk, and the other side is an empty pane that says so */
const DELETED_ROWS: MergeRow[] = [
  "use anchor_lang::prelude::*;",
  "",
  "pub fn legacy_greeting() -> &'static str {",
  '    "Hi"',
  "}",
].map((text, i): MergeRow => ({
  left: { text, state: "conflict", actions: i === 0 ? TAKE_LEFT : undefined },
  result: { text, state: "conflict" },
  right: null,
}))
const DELETED_LEFT = [band(DELETED_ROWS, 0, 5, 5, "conflict")]
const DELETED_RIGHT = [band(DELETED_ROWS, 0, 5, 0, "conflict")]

function MergeLines({ rows, side, start = 1 }: { rows: MergeRow[]; side: "left" | "result" | "right"; start?: number }) {
  /* each row's line number in this pane: a fold skips its lines, a spacer has none */
  const lines = (row: MergeRow) => ("fold" in row ? row.fold : "bar" in row ? 0 : row[side] ? 1 : 0)
  const numbers = rows.map((_, i) => start + rows.slice(0, i).reduce((n, row) => n + lines(row), 0))
  return (
    <div className="min-w-0 flex-1 py-1 font-mono text-[0.8125rem] leading-5">
      {rows.map((row, i) => {
        if ("fold" in row) return <MergeFold key={i} count={row.fold} />
        if ("bar" in row) return side === "result" ? <div key={i}>{HUNK_BAR}</div> : null
        const cell = row[side]
        /* a spacer only aligns panes side by side; one pane at a time needs none */
        if (!cell) return <div key={i} className="h-5 @max-3xl/merge:hidden" />
        const number = numbers[i]
        return (
          <div key={i} className={cn("relative flex h-5 items-center", cell.state && mergeHunkVariants({ state: cell.state }))}>
            <span className="flex w-10 shrink-0 items-center justify-end pr-3 text-xs text-subtle tabular-nums select-none">{number}</span>
            <code className="min-w-0 flex-1 overflow-hidden whitespace-pre text-foreground">{highlight(cell.text, SYNTAX_BOTH)}</code>
          </div>
        )
      })}
    </div>
  )
}

/* Each side's controls for one hunk */
const TAKE = { left: TAKE_LEFT, right: TAKE_RIGHT }

/* A row's controls on one side; a fold or a bar row has none */
const rowActions = (row: MergeRow, side: "left" | "right") => ("fold" in row || "bar" in row ? undefined : row[side]?.actions)

/* A side's hunk controls in its gutter, each at its row's height. A side
   that deleted the file has no lines, but its one hunk -- the whole file --
   is still taken or dismissed from the top of its gutter, as in the app */
function MergeGutter({ rows, side, deleted = false }: { rows: MergeRow[]; side: "left" | "right"; deleted?: boolean }) {
  return (
    <MergeHunkGutter>
      {rows.map((row, i) => {
        const actions = deleted ? i === 0 && TAKE[side] : rowActions(row, side)
        if (!actions) return null
        return (
          <div key={i} className="absolute inset-x-0 flex items-center justify-center" style={{ top: rowTop(rows, i), height: LINE }}>
            {actions}
          </div>
        )
      })}
    </MergeHunkGutter>
  )
}

function MergeSpecimen({
  rows,
  left,
  right,
  start,
  count,
  phone = false,
  path = "src/lib.rs",
  deletedRight = false,
}: {
  rows: MergeRow[]
  left: MergeBand[]
  right: MergeBand[]
  start?: number
  count: number
  phone?: boolean
  path?: string
  deletedRight?: boolean
}) {
  return (
    <Merge>
      <MergeToolbar>
        <MergeNav to="previous-file" disabled />
        <MergeNav to="next-file" />
        <MergeTitle path={path} index={1} total={2} />
        <MergeCount count={count} />
        <MergeNav to="previous-conflict" disabled={count === 0} />
        <MergeNav to="next-conflict" disabled={count === 0} />
        <MergeShowAll />
      </MergeToolbar>
      <MergePaneTabs />
      <MergePanes>
        <MergePane side="left">
          <MergePaneHeader />
          <MergePaneBody>
            <MergeLines rows={rows} side="left" start={start} />
            <MergeGutter rows={rows} side="left" />
          </MergePaneBody>
        </MergePane>
        <MergeRibbon bands={left} />
        <MergePane side="result">
          <MergePaneHeader />
          <MergePaneBody>
            <MergeLines rows={phone ? conflictRows(true) : rows} side="result" start={start} />
          </MergePaneBody>
        </MergePane>
        <MergeRibbon bands={right} />
        <MergePane side="right" deleted={deletedRight}>
          <MergePaneHeader />
          <MergePaneBody>
            <MergeGutter rows={rows} side="right" deleted={deletedRight} />
            {!deletedRight && <MergeLines rows={rows} side="right" start={start} />}
          </MergePaneBody>
        </MergePane>
      </MergePanes>
      <MergeFooter>
        <MergeFooterShortcuts>
          <Button size="sm" variant="outline">Keep this version</Button>
          <Button size="sm" variant="outline">Take the other version</Button>
        </MergeFooterShortcuts>
        <MergeFooterActions>
          <Button size="sm" variant="ghost">Cancel</Button>
          <Button size="sm" disabled={count > 0}>Apply</Button>
        </MergeFooterActions>
      </MergeFooter>
    </Merge>
  )
}

/* ── the components ────────────────────────────────────────────────────── */

function PlaygroundComponents() {
  return (
    <>
      <Block
        id="stepper"
        title="Stepper"
        source="playground"
        registry="stepper"
        note="The development loop as one switch. A thumb in Solana's two colours slides to the current stage. Each stage says how it stands, in words for a screen reader too. Built on Tabs, so the arrow keys move along it."
        more={
          <More label="Compact, when the rail is narrow">
            <Stepper defaultValue="deploy">
              <StepperList compact>
                <StepperItem value="write" status="done">Write</StepperItem>
                <StepperItem value="build" status="done">Build</StepperItem>
                <StepperItem value="deploy" status="running">Deploy</StepperItem>
                <StepperItem value="interact">Interact</StepperItem>
              </StepperList>
            </Stepper>
          </More>
        }
      >
        <Stepper defaultValue="build">
          <StepperList>
            <StepperItem value="write" status="done">Write</StepperItem>
            <StepperItem value="build" status="running">Build</StepperItem>
            <StepperItem value="deploy" target>Deploy</StepperItem>
            <StepperItem value="interact">Interact</StepperItem>
          </StepperList>
        </Stepper>
        <Stepper defaultValue="build">
          <StepperList>
            <StepperItem value="write" status="done">Write</StepperItem>
            <StepperItem value="build" status="failed" errors={2}>Build</StepperItem>
            <StepperItem value="deploy">Deploy</StepperItem>
            <StepperItem value="interact">Interact</StepperItem>
          </StepperList>
        </Stepper>
      </Block>

      <Block
        id="segmented"
        title="Segmented"
        source="playground"
        registry="segmented"
        note="One choice out of a few, and always one. Four looks from client-v2: a sliding thumb, boxed tabs with a count, a gradient ring for a choice that matters, and chips for a network."
      >
        <Segmented defaultValue="files" aria-label="Left panel">
          <SegmentedItem value="files">Files</SegmentedItem>
          <SegmentedItem value="lessons">Lessons</SegmentedItem>
        </Segmented>
        <Segmented variant="boxed" defaultValue="tutorials" aria-label="Gallery">
          <SegmentedItem value="tutorials">Tutorials<SegmentedCount>12</SegmentedCount></SegmentedItem>
          <SegmentedItem value="programs">Programs<SegmentedCount>34</SegmentedCount></SegmentedItem>
        </Segmented>
        <Segmented variant="gradient" defaultValue="anchor" aria-label="Framework">
          <SegmentedItem value="anchor">Anchor</SegmentedItem>
          <SegmentedItem value="native">Native</SegmentedItem>
          <SegmentedItem value="seahorse">Seahorse</SegmentedItem>
        </Segmented>
        <Segmented variant="chips" defaultValue="devnet" aria-label="Network">
          <SegmentedItem value="surfpool">Surfpool</SegmentedItem>
          <SegmentedItem value="devnet">Devnet</SegmentedItem>
          <SegmentedItem value="testnet">Testnet</SegmentedItem>
          <SegmentedItem value="custom">Custom</SegmentedItem>
        </Segmented>
      </Block>

      <Block
        id="brand-button"
        title="Brand button"
        source="playground"
        registry="brand-button"
        note="The one call to action a screen has. At rest a hairline of Solana's two colours; on hover it fills with them and lifts a pixel. accent is the flat purple, for where the ring would shout."
      >
        <BrandButton>
          Start building
          <BrandButtonIcon />
        </BrandButton>
        <BrandButton size="sm">
          Show me how
          <BrandButtonIcon />
        </BrandButton>
        <BrandButton size="icon" aria-label="Run">
          <BrandButtonIcon />
        </BrandButton>
        <BrandButton variant="accent">Start</BrandButton>
        <BrandButton disabled>
          Not yet
          <BrandButtonIcon />
        </BrandButton>
      </Block>

      <Block
        id="async-button"
        title="Async button"
        source="playground"
        registry="async-button"
        note="A Button that waits for its own work. Its onClick returns a promise, and it disables itself with a spinner until that settles. So a slow build cannot start twice."
      >
        <AsyncButton variant="outline" loadingText="Building" onClick={() => new Promise((r) => setTimeout(r, 1800))}>
          <Hammer data-icon="inline-start" />
          Build
        </AsyncButton>
        <AsyncButton loading loadingText="Deploying">
          Deploy
        </AsyncButton>
      </Block>

      <Block id="copy-button" title="Copy button and help tip" source="playground" registry="copy-button" note="Copy for one value, with a tooltip that turns to Copied in green. The help tip is a small question mark with a large place to press.">
        <div className="flex items-center gap-2 rounded-lg bg-surface-panel px-3 py-2">
          <code className="font-mono text-code text-foreground">7Hq5…Xk2P</code>
          <CopyButton value={PROGRAM_ID} label="Copy the program id" />
        </div>
        <div className="flex items-center gap-2 text-caption text-muted-foreground">
          Compute units
          <HelpTip>How much work a transaction may do. The default is 200,000 per instruction.</HelpTip>
        </div>
      </Block>

      <Block
        id="composer"
        title="Composer"
        source="playground"
        registry="composer"
        note="Where you ask the assistant. A note above it, the files it will read, the words, then the tools. Enter sends, Shift and Enter make a new line. While it answers, Send becomes Stop."
        className="block"
      >
        <Composer className="max-w-xl">
          <ComposerBanner>
            <Sparkles className="size-3.5 text-brand-purple" />
            Hosted model, no key needed
          </ComposerBanner>
          <ComposerContextList>
            <ComposerChip><FileCode2 />lib.rs</ComposerChip>
            <ComposerChip>lines 6 to 9</ComposerChip>
          </ComposerContextList>
          <ComposerInput placeholder="Describe a program, or ask anything about Solana" />
          <ComposerToolbar>
            <ComposerAdd />
            <ComposerModel>Claude Sonnet</ComposerModel>
            <ComposerEffort value={2} />
            <ComposerSend><LogoMark className="size-4" /></ComposerSend>
          </ComposerToolbar>
        </Composer>
      </Block>

      <Block
        id="console-drawer"
        title="Console drawer"
        source="playground"
        registry="console-drawer"
        note="The console under the stage. A thin frosted strip says how the last run went. The well above it opens by height, so the terminal stays mounted. The strip toggles it, and so does ⌘J."
        className="block"
      >
        <ConsoleDrawer defaultOpen hotkey={null} className="max-w-2xl rounded-xl border border-border">
          <ConsoleDrawerBar>
            <ConsoleDrawerStatus>
              <StatusDot variant="success" />
              Built in 11.8 s
            </ConsoleDrawerStatus>
            <ConsoleDrawerActions>
              <Kbd>⌘J</Kbd>
              <Button variant="ghost" size="xs">Clear</Button>
            </ConsoleDrawerActions>
          </ConsoleDrawerBar>
          <ConsoleDrawerContent className="h-40">
            <Terminal className="rounded-none border-0">
              <TerminalLine variant="prompt">build</TerminalLine>
              <TerminalLine variant="info">Building hello_anchor with Anchor 1.2…</TerminalLine>
              <TerminalLine variant="success">Build successful. Completed in 11.8 s.</TerminalLine>
              <TerminalLine variant="prompt"><TerminalCaret /></TerminalLine>
            </Terminal>
          </ConsoleDrawerContent>
        </ConsoleDrawer>
      </Block>

      <Block id="terminal" title="Terminal" source="playground" registry="terminal" note="What you typed, what came back and how it went. The well is one step darker than the stage. The product's terminal is xterm; this is its look, for logs and specimens." className="block">
        <Terminal className="max-w-xl">
          <TerminalLine variant="prompt">deploy --devnet</TerminalLine>
          <TerminalLine>Program Id: 7Hq5…Xk2P</TerminalLine>
          <TerminalLine variant="warning">Paid by Kora. Your balance is untouched.</TerminalLine>
          <TerminalLine variant="error">Rate limited. Try again in 40 s.</TerminalLine>
        </Terminal>
      </Block>

      <Block id="code-block" title="Code block" source="playground" registry="code-block" note="Code in the code face, with the product's syntax colours. The line numbers are drawn by CSS, so a copy leaves them behind. Copy shows on hover, and always on a touch screen." className="block">
        <CodeBlock className="max-w-xl">
          <CodeBlockHeader>
            <CodeBlockTitle>lib.rs</CodeBlockTitle>
            <CodeBlockActions>
              <CopyButton value={SAMPLE} label="Copy code" />
            </CodeBlockActions>
          </CodeBlockHeader>
          <CodeBlockContent>
            {SAMPLE.split("\n").map((line, i) => (
              <CodeBlockLine key={i}>{highlight(line)}</CodeBlockLine>
            ))}
          </CodeBlockContent>
        </CodeBlock>
      </Block>

      <Block id="diagnostic" title="Diagnostic" source="playground" registry="diagnostic" note="A build error said the way a person would. What went wrong, where, and the line itself with the fault marked. The compiler's own words wait behind a toggle." className="block">
        <Diagnostic className="max-w-xl">
          <DiagnosticHeader>
            <CircleAlert />
            <DiagnosticTitle>initialize is missing its accounts</DiagnosticTitle>
            <DiagnosticCode>E0412</DiagnosticCode>
          </DiagnosticHeader>
          <DiagnosticDescription>The Context names a struct that does not exist yet.</DiagnosticDescription>
          <DiagnosticSource>
            <DiagnosticLine number={6}>{"    // Say hello, then stop"}</DiagnosticLine>
            <DiagnosticLine number={7} fault="cannot find type Initialize in this scope">
              {"    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {"}
            </DiagnosticLine>
            <DiagnosticLine number={8}>{'        msg!("Hello, Playground");'}</DiagnosticLine>
          </DiagnosticSource>
          <DiagnosticFooter>
            <Button size="sm" variant="outline"><Sparkles data-icon="inline-start" />Fix with the assistant</Button>
            <Button size="sm" variant="ghost">Show compiler output</Button>
          </DiagnosticFooter>
        </Diagnostic>
      </Block>

      <Block id="diff" title="Diff" source="playground" registry="diff" note="A change the assistant suggests, read before it lands. Added lines in green, removed in red, each with its own mark, since colour alone would not say it." className="block">
        <Diff className="max-w-xl">
          <DiffHeader>
            <DiffTitle>lib.rs</DiffTitle>
            <DiffStat added={2} removed={1} />
          </DiffHeader>
          <DiffContent>
            <DiffLine>{"    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {"}</DiffLine>
            <DiffLine variant="removed">{'        msg!("Hi");'}</DiffLine>
            <DiffLine variant="added">{'        msg!("Hello, Playground");'}</DiffLine>
            <DiffLine variant="added">{"        ctx.accounts.counter.count += 1;"}</DiffLine>
          </DiffContent>
          <DiffFooter>
            <Button size="sm">Apply</Button>
            <Button size="sm" variant="ghost">Discard</Button>
          </DiffFooter>
        </Diff>
      </Block>

      <Block
        id="merge"
        title="Merge"
        source="playground"
        registry="merge"
        note="Two devices changed the same lines, and the merge will not choose for you. This device on the left, the other device on the right, the result between, each hunk joined across by a ribbon: red is yours to decide, blue merged on its own, green taken, grey left out. » and « take a side's lines, × leaves them out. It draws; the editors in the panes are the app's. In a narrow box it shows one pane at a time."
        className="block"
        more={
          <>
            <More label="Decided: this device's line taken, the other device's dismissed" className="block">
              <div className="h-64 max-w-5xl overflow-hidden rounded-2xl border border-border-strong bg-surface-panel">
                <MergeSpecimen rows={DECIDED_ROWS} left={DECIDED_LEFT} right={DECIDED_RIGHT} start={32} count={0} />
              </div>
            </More>
            <More label="Deleted on the other device, edited here: the whole file is one hunk" className="block">
              <div className="h-64 max-w-5xl overflow-hidden rounded-2xl border border-border-strong bg-surface-panel">
                <MergeSpecimen rows={DELETED_ROWS} left={DELETED_LEFT} right={DELETED_RIGHT} count={1} path="src/legacy.rs" deletedRight />
              </div>
            </More>
            <More label="On a phone, 390 px: one pane at a time, the result carrying both sides' controls" className="block">
              <div className="h-[34rem] w-[390px] max-w-full overflow-hidden rounded-2xl border border-border-strong bg-surface-panel">
                <MergeSpecimen rows={CONFLICT_ROWS} left={CONFLICT_LEFT} right={CONFLICT_RIGHT} count={1} phone />
              </div>
            </More>
            <More label="In the wide modal">
              <Modal>
                <ModalTrigger asChild>
                  <Button variant="outline">Resolve…</Button>
                </ModalTrigger>
                <ModalContent size="wide" className="md:h-[min(40rem,calc(100dvh-4rem))]">
                  <ModalHeader>
                    <ModalTitle>Resolve conflicts</ModalTitle>
                    <ModalDescription className="sr-only">Both devices changed the same lines of src/lib.rs.</ModalDescription>
                  </ModalHeader>
                  <MergeSpecimen rows={CONFLICT_ROWS} left={CONFLICT_LEFT} right={CONFLICT_RIGHT} count={1} />
                </ModalContent>
              </Modal>
            </More>
          </>
        }
      >
        <div className="h-[30rem] max-w-5xl overflow-hidden rounded-2xl border border-border-strong bg-surface-panel">
          <MergeSpecimen rows={CONFLICT_ROWS} left={CONFLICT_LEFT} right={CONFLICT_RIGHT} count={1} />
        </div>
      </Block>

      <Block id="callout" title="Callout" source="playground" registry="callout" note="A note in a page or a form: a tint and a hairline, calm enough to read past. Alert speaks for the whole page. A callout speaks for the place it sits." className="block">
        <div className="grid max-w-xl gap-3">
          <Callout variant="info">
            <Info />
            <CalloutTitle>Kora pays the rent</CalloutTitle>
            <CalloutDescription>This deploy to devnet needs no SOL.</CalloutDescription>
          </Callout>
          <Callout variant="warning">
            <TriangleAlert />
            <CalloutTitle>Closes in 2 days</CalloutTitle>
            <CalloutDescription>Programs that sit unused for 7 days are closed. Run a transaction to keep it.</CalloutDescription>
          </Callout>
          <Callout variant="error">
            <CircleAlert />
            <CalloutTitle>The paymaster said no</CalloutTitle>
            <CalloutDescription>The program is over the size Kora will pay for. Try a smaller build.</CalloutDescription>
          </Callout>
        </div>
      </Block>

      <Block id="tag" title="Tag" source="playground" registry="tag" note="A tinted label that sorts a thing by kind: its level, its framework, its language. A Badge says a state. The levels keep client-v2's colours.">
        {["Beginner", "Intermediate", "Advanced"].map((level) => (
          <Tag key={level} variant={levelVariant(level)}>{level}</Tag>
        ))}
        <Tag>Anchor</Tag>
        <Tag variant="brand">New</Tag>
      </Block>

      <Block id="status-dot" title="Status dot" source="playground" registry="status-dot" note="The product's one sign for state, always beside a word. Running pulses, and stops pulsing for anyone who asked for less motion.">
        {(
          [
            ["success", "Ready"],
            ["running", "Building"],
            ["warning", "Rate limited"],
            ["error", "Failed"],
            ["idle", "Idle"],
          ] as const
        ).map(([variant, label]) => (
          <span key={variant} className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <StatusDot variant={variant} />
            {label}
          </span>
        ))}
      </Block>

      <Block id="action-card" title="Action card" source="playground" registry="action-card" note="A card you open: a tutorial, a sample, a program. Its link covers the whole card, so the card is one target and its text stays selectable. frame is the older card's lift and ring. The glyph media variant is the icon alone, with no tile behind it, for a vertical card." className="grid gap-3 md:grid-cols-2">
        <ActionCard>
          <ActionCardMedia><Coins /></ActionCardMedia>
          <ActionCardContent>
            <ActionCardEyebrow>Sample · Anchor</ActionCardEyebrow>
            <ActionCardTitle><ActionCardLink href="#c-action-card">Tip jar</ActionCardLink></ActionCardTitle>
            <ActionCardDescription>Take tips in SOL and send them on to one wallet.</ActionCardDescription>
          </ActionCardContent>
          <ActionCardAction><Button size="sm" variant="outline">Open</Button></ActionCardAction>
        </ActionCard>
        <ActionCard orientation="vertical">
          <ActionCardMedia variant="glyph"><Plus /></ActionCardMedia>
          <ActionCardContent>
            <ActionCardTitle><ActionCardLink href="#c-action-card">New project</ActionCardLink></ActionCardTitle>
            <ActionCardDescription>Anchor, Native or Seahorse</ActionCardDescription>
          </ActionCardContent>
        </ActionCard>
        <ActionCard variant="frame">
          <ActionCardMedia><Vote /></ActionCardMedia>
          <ActionCardContent>
            <ActionCardEyebrow>Sample · Anchor</ActionCardEyebrow>
            <ActionCardTitle><ActionCardLink href="#c-action-card">Voting</ActionCardLink></ActionCardTitle>
            <ActionCardDescription>One wallet, one vote, counted on chain.</ActionCardDescription>
          </ActionCardContent>
        </ActionCard>
      </Block>

      <Block id="setup-list" title="Setup list" source="playground" registry="setup-list" note="The few things a new workspace needs, in the sidebar. It folds when you want it out of the way. It goes once every step is done.">
        <div className="w-64 rounded-xl border border-border bg-surface-panel p-1.5">
          <SetupList defaultOpen>
            <SetupListHeader>
              <SetupListTrigger done={2} total={4}>Get set up</SetupListTrigger>
              <SetupListDismiss />
            </SetupListHeader>
            <SetupListContent>
              <SetupListItem status="done">
                <SetupListIndicator />
                <SetupListLabel>Sign in with GitHub</SetupListLabel>
              </SetupListItem>
              <SetupListItem status="done">
                <SetupListIndicator />
                <SetupListLabel>Make a wallet</SetupListLabel>
              </SetupListItem>
              <SetupListItem status="warn">
                <SetupListIndicator />
                <SetupListLabel>Airdrop devnet SOL</SetupListLabel>
                <SetupListValue>Retry</SetupListValue>
              </SetupListItem>
              <SetupListItem>
                <SetupListIndicator />
                <SetupListLabel>Deploy a program</SetupListLabel>
                <SetupListValue>0 SOL</SetupListValue>
              </SetupListItem>
            </SetupListContent>
          </SetupList>
        </div>
      </Block>

      <Block id="step-rail" title="Step rail" source="playground" registry="step-rail" note="A lesson's steps as a line down the side. Done steps are ticked and joined in green. A skipped one is dashed. The current one is a purple dot with a halo. It shows where you are; it is not a way to jump.">
        <StepRail className="w-64">
          <StepRailItem status="done">
            <StepRailIndicator />
            <StepRailTitle>Open the program</StepRailTitle>
          </StepRailItem>
          <StepRailItem status="skipped">
            <StepRailIndicator />
            <StepRailTitle>Read about accounts</StepRailTitle>
            <StepRailMeta>Skipped</StepRailMeta>
          </StepRailItem>
          <StepRailItem status="current">
            <StepRailIndicator />
            <StepRailTitle>Add an instruction</StepRailTitle>
            <StepRailMeta>Step 3 of 6</StepRailMeta>
          </StepRailItem>
          <StepRailItem>
            <StepRailIndicator />
            <StepRailTitle>Build it</StepRailTitle>
          </StepRailItem>
        </StepRail>
      </Block>

      <Block id="objective-band" title="Objective band" source="playground" registry="objective-band" note="A lesson's band over the stage: how far along, what to do now, and the way on. It is frosted, so the work shows through. On a phone it folds to one row that opens in place, and its actions move to a bar at the foot of the code." className="block">
        <div className="flex max-w-2xl flex-col gap-4">
          <ObjectiveBand className="overflow-hidden rounded-xl border">
            <ObjectiveRow>
              <ObjectiveMain>
                <ObjectiveCount>Step 2 of 4</ObjectiveCount>
                <ObjectiveMeter value={0.25} />
                <ObjectiveText>Give the program an initialize instruction</ObjectiveText>
                <ObjectiveCheck open={false} />
              </ObjectiveMain>
              <ObjectiveActions>
                <ObjectiveNav canBack canNext={false} />
                <ObjectiveQuiet>Read the page</ObjectiveQuiet>
                <ObjectivePrimary>I'm stuck</ObjectivePrimary>
              </ObjectiveActions>
            </ObjectiveRow>
          </ObjectiveBand>
          <div className="w-[393px] overflow-hidden rounded-xl border">
            <ObjectiveFold open={false} position="2/4" value={0.25} objective="Give the program an initialize instruction" />
            <ObjectiveBar>
              <ObjectiveNav size="phone" canBack canNext={false} />
              <div className="ml-auto flex items-center gap-1">
                <ObjectiveQuiet size="phone">Read the page</ObjectiveQuiet>
                <ObjectivePrimary size="phone">I'm stuck</ObjectivePrimary>
              </div>
            </ObjectiveBar>
          </div>
        </div>
      </Block>

      <Block id="stage-empty" title="Stage empty" source="playground" registry="stage-empty" note="What a stage says before there is anything on it: what it is for, what it needs and the one thing to do. It sits on the stage's own ground. On a phone the actions pin to the foot." className="block">
        <StageEmpty className="px-0">
          <StageEmptyMedia><Rocket /></StageEmptyMedia>
          <StageEmptyTitle>Nothing deployed yet</StageEmptyTitle>
          <StageEmptyMeta>hello_anchor · 184 KB · devnet</StageEmptyMeta>
          <StageEmptyDescription>Build your program, then deploy it. Kora pays for devnet, so it needs no SOL.</StageEmptyDescription>
          <StageEmptyActions>
            <BrandButton>Deploy to devnet<BrandButtonIcon /></BrandButton>
            <Button variant="ghost">Choose a network</Button>
          </StageEmptyActions>
          <StageEmptyFooter>Programs close after 7 days without use.</StageEmptyFooter>
        </StageEmpty>
      </Block>

      <Block id="modal" title="Modal" source="playground" registry="modal" note="The product's dialog. On a desk, a card on the dimmed stage with the title on the left. On a phone, a page of its own with its buttons pinned to the foot. wide is the gallery's.">
        <Modal>
          <ModalTrigger asChild>
            <Button variant="outline"><Share2 data-icon="inline-start" />Share project</Button>
          </ModalTrigger>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Share through GitHub</ModalTitle>
              <ModalDescription>We save the project as a gist. Anyone with the link can open it.</ModalDescription>
            </ModalHeader>
            <ModalBody>
              <Field>
                <FieldLabel htmlFor="gist-name">Name</FieldLabel>
                <Input id="gist-name" defaultValue="hello_anchor" />
              </Field>
            </ModalBody>
            <ModalFooter>
              <Button variant="ghost">Cancel</Button>
              <Button>Create gist</Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </Block>

      <Block id="menu-extras" title="Menu extras" source="playground" registry="menu-extras" note="What client-v2's four menus do that shadcn's leave out: a line under an item's name, a note that is not an item, and rows that fold open in place. They go inside DropdownMenu and ContextMenu as they are.">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline">Claude Sonnet</Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-72">
            <DropdownMenuItem>
              <MenuItemText>
                Claude Sonnet
                <MenuItemDescription>Fast, and good at Anchor</MenuItemDescription>
              </MenuItemText>
              <DropdownMenuShortcut>S</DropdownMenuShortcut>
            </DropdownMenuItem>
            <DropdownMenuItem>
              <MenuItemText>
                Claude Opus
                <MenuItemDescription>Slower, for the hard bugs</MenuItemDescription>
              </MenuItemText>
              <DropdownMenuShortcut>O</DropdownMenuShortcut>
            </DropdownMenuItem>
            <MenuFold>
              <MenuFoldTrigger asChild>
                <DropdownMenuItem onSelect={(e) => e.preventDefault()}>
                  Your own key
                  <MenuFoldChevron />
                </DropdownMenuItem>
              </MenuFoldTrigger>
              <MenuFoldContent>
                <DropdownMenuItem><KeyRound />Add an API key</DropdownMenuItem>
              </MenuFoldContent>
            </MenuFold>
            <DropdownMenuSeparator />
            <MenuNote>The hosted models need no key.</MenuNote>
          </DropdownMenuContent>
        </DropdownMenu>
      </Block>

      <Block id="editor-tabs" title="Editor tabs" source="playground" registry="editor-tabs" note="The open files over the editor. The current one sits on the editor's ground with a purple line along its top. Close shows on hover and on the current tab." className="block">
        <EditorTabs className="max-w-xl rounded-t-xl">
          <EditorTab active>
            <EditorTabTrigger><FileCode2 /><EditorTabLabel>lib.rs</EditorTabLabel></EditorTabTrigger>
            <EditorTabClose aria-label="Close lib.rs" />
          </EditorTab>
          <EditorTab>
            <EditorTabTrigger><FileCode2 /><EditorTabLabel>state.rs</EditorTabLabel></EditorTabTrigger>
            <EditorTabClose aria-label="Close state.rs" />
          </EditorTab>
          <EditorTab menuOpen>
            <EditorTabTrigger><FileJson /><EditorTabLabel>Anchor.toml</EditorTabLabel></EditorTabTrigger>
            <EditorTabClose aria-label="Close Anchor.toml" />
          </EditorTab>
        </EditorTabs>
      </Block>

      <Block id="drop-zone" title="Drop zone" source="playground" registry="drop-zone" note="Where a file lands: an IDL, a keypair, a program to import. It is also a button to browse, since not everyone can drag.">
        <DropZone className="max-w-sm" accept=".json">
          <DropZoneIcon><Upload /></DropZoneIcon>
          <DropZoneTitle>Drop an IDL here</DropZoneTitle>
          <DropZoneDescription>or press to choose a .json file</DropZoneDescription>
        </DropZone>
      </Block>

      <Block id="achievement" title="Achievement" source="playground" registry="achievement" note="An achievement as a profile will show it. This is proposed, for profiles in v0.2. A ring of the brand's gradient once earned, grey until then.">
        <Achievement>
          <AchievementMedia><Rocket /></AchievementMedia>
          <AchievementLabel>First deploy</AchievementLabel>
        </Achievement>
        <Achievement>
          <AchievementMedia><BookOpen /></AchievementMedia>
          <AchievementLabel>Five lessons</AchievementLabel>
        </Achievement>
        <Achievement earned={false}>
          <AchievementMedia><Trophy /></AchievementMedia>
          <AchievementLabel>Mainnet</AchievementLabel>
        </Achievement>
      </Block>

      <Block id="logo" title="Logo" source="playground" registry="logo" note="The lockup heads the navigation, as the prototype's header sets it; the ring mark stays the send glyph and the phone's Home. Both take the colour of their text.">
        <LogoLockup />
        <Logo>
          <LogoMark />
          <LogoText>Playground</LogoText>
        </Logo>
        <Logo className="text-brand-purple">
          <LogoMark className="size-8" />
        </Logo>
      </Block>
    </>
  )
}

/* ── blocks: screens' worth of parts ──────────────────────────────────── */

function PlaygroundBlocks() {
  return (
    <>
      <Block id="block-work-head" title="Work head" source="block" note="The rail over the stage: the project, the loop, the network and whether the assistant is ready. Frosted, with the stepper in the middle." className="block">
        <div className="frosted flex max-w-4xl flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-1.5">
          <span className="font-mono text-code text-foreground">hello_anchor</span>
          <Stepper defaultValue="deploy" className="mx-auto">
            <StepperList>
              <StepperItem value="write" status="done">Write</StepperItem>
              <StepperItem value="build" status="done">Build</StepperItem>
              <StepperItem value="deploy">Deploy</StepperItem>
              <StepperItem value="interact">Interact</StepperItem>
            </StepperList>
          </Stepper>
          <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <StatusDot variant="success" size="lg" />
            Devnet
          </span>
          <span className="inline-flex items-center gap-1.5 text-caption text-muted-foreground">
            <Sparkles className="size-3.5 text-brand-purple" />
            Ready
          </span>
        </div>
      </Block>

      <Block id="block-deploy-result" title="Deploy result" source="block" note="After a deploy: the program id to copy, where to see it and when it closes. One accent action, the rest quiet.">
        <div role="status" className="flex w-full max-w-md flex-col gap-3 rounded-xl border border-border bg-surface-panel p-4">
          <div className="flex items-center gap-2 text-control font-act text-foreground">
            <StatusDot variant="success" size="lg" />
            Deployed to devnet
          </div>
          <div className="flex items-center gap-2 rounded-lg bg-surface-base px-3 py-2">
            <span className="text-caption text-subtle">Program id</span>
            <code className="font-mono text-code text-foreground" title={PROGRAM_ID}>7Hq5…Xk2P</code>
            <CopyButton value={PROGRAM_ID} label="Copy the program id" className="ml-auto" />
          </div>
          <Callout variant="info">
            <Info />
            <CalloutDescription>It closes after 7 days without use. Redeploy any time.</CalloutDescription>
          </Callout>
          <div className="flex gap-2">
            <Button size="sm">Try it in Interact</Button>
            <Button size="sm" variant="ghost">Open in Explorer<ExternalLink data-icon="inline-end" /></Button>
          </div>
        </div>
      </Block>

      <Block id="block-tutorials" title="Tutorial gallery" source="block" note="Tutorials as action cards, each with its level as a tag and how far you got. Two columns on a desk, one on a phone." className="grid max-w-3xl gap-3 md:grid-cols-2">
        {[
          { title: "Hello Anchor", level: "Beginner", minutes: 15, progress: 40, icon: <Rocket /> },
          { title: "Token faucet", level: "Intermediate", minutes: 30, progress: 0, icon: <Coins /> },
          { title: "Escrow", level: "Advanced", minutes: 45, progress: 0, icon: <Wallet /> },
          { title: "Voting", level: "Beginner", minutes: 20, progress: 100, icon: <Vote /> },
        ].map((t) => (
          <ActionCard key={t.title}>
            <ActionCardMedia>{t.icon}</ActionCardMedia>
            <ActionCardContent className="gap-1.5">
              <div className="flex items-center gap-2">
                <Tag variant={levelVariant(t.level)}>{t.level}</Tag>
                <ActionCardEyebrow>{t.minutes} min</ActionCardEyebrow>
              </div>
              <ActionCardTitle><ActionCardLink href="#c-block-tutorials">{t.title}</ActionCardLink></ActionCardTitle>
              <Progress value={t.progress} aria-label={`${t.progress}% done`} className="h-1" />
            </ActionCardContent>
          </ActionCard>
        ))}
      </Block>

      <Block id="block-start" title="Start from scratch" source="block" note="A new program in three choices: a framework, a name, then Start. The framework is the choice that matters, so it gets the gradient ring." className="block">
        <div className="flex max-w-xl flex-col gap-4 rounded-2xl border border-border bg-surface-panel p-5">
          <div className="flex items-center gap-3">
            <span className="grid size-10 place-items-center rounded-[10px] bg-surface-raised text-muted-foreground"><Plus className="size-5" /></span>
            <div>
              <div className="text-control font-act text-foreground">Start from scratch</div>
              <div className="text-caption font-read text-muted-foreground">An empty program, ready to build.</div>
            </div>
          </div>
          <Segmented variant="gradient" defaultValue="anchor" aria-label="Framework">
            <SegmentedItem value="anchor">Anchor</SegmentedItem>
            <SegmentedItem value="native">Native</SegmentedItem>
            <SegmentedItem value="seahorse">Seahorse</SegmentedItem>
          </Segmented>
          <div className="flex flex-wrap gap-2">
            <Input aria-label="Program name" defaultValue="my_program" className="w-48" />
            <BrandButton variant="accent">Start</BrandButton>
          </div>
        </div>
      </Block>

      <Block id="block-settings" title="Setting row" source="block" note="Settings as rows: what it is and what it does on the left, the control on the right, hairlines between." className="block">
        <div className="max-w-2xl divide-y divide-border rounded-xl border border-border">
          <Field orientation="horizontal" className="p-4">
            <FieldContent>
              <FieldLabel>Network</FieldLabel>
              <FieldDescription>Where deploys and transactions go.</FieldDescription>
            </FieldContent>
            <Segmented variant="chips" defaultValue="devnet" aria-label="Network">
              <SegmentedItem value="surfpool">Surfpool</SegmentedItem>
              <SegmentedItem value="devnet">Devnet</SegmentedItem>
              <SegmentedItem value="testnet">Testnet</SegmentedItem>
            </Segmented>
          </Field>
          <Field orientation="horizontal" className="p-4">
            <FieldContent>
              <FieldLabel>Anchor version</FieldLabel>
              <FieldDescription>New programs start on this one.</FieldDescription>
            </FieldContent>
            <Select defaultValue="1.2">
              <SelectTrigger className="w-44" aria-label="Anchor version"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="1.2">Anchor 1.2</SelectItem>
                <SelectItem value="1.1.2">Anchor 1.1.2</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Block>

      <Block id="block-session" title="Session footer" source="block" note="The foot of the sidebar: which cluster, and who you are. Two rows, each a button that opens its menu." className="block">
        <div className="flex w-60 flex-col gap-0.5 rounded-xl border border-border bg-surface-panel p-1.5">
          <button type="button" className="flex h-8 items-center gap-2 rounded-md px-2 text-[0.8125rem] text-muted-foreground hover:bg-surface-hover hover:text-foreground">
            <StatusDot variant="success" size="lg" />
            Devnet
            <span className="ml-auto text-xs text-subtle">Kora</span>
          </button>
          <button type="button" className="flex items-center gap-2 rounded-md p-2 text-left hover:bg-surface-hover">
            <Avatar className="size-6"><AvatarFallback className="text-[10px]">NT</AvatarFallback></Avatar>
            <span className="flex min-w-0 flex-col">
              <span className="truncate text-[0.8125rem] font-act text-foreground">nikita</span>
              <span className="truncate font-mono text-xs text-muted-foreground">7Hq5…Xk2P · 2.4 SOL</span>
            </span>
          </button>
        </div>
      </Block>

      <Block id="block-phone-start" title="Phone quickstart" source="block" note="The phone's start screen: rows a thumb can hit, 64 px high, each with a tinted tile. The composer waits at the foot." className="block">
        <div className="flex w-[360px] max-w-full flex-col gap-1 rounded-card border border-border bg-background p-3">
          {[
            { label: "Start a lesson", note: "Hello Anchor, 15 min", tint: "bg-brand-purple/12 text-brand-purple", icon: <BookOpen className="size-5" /> },
            { label: "Open a sample", note: "Counter, tip jar, voting", tint: "bg-success/12 text-success", icon: <Copy className="size-5" /> },
            { label: "Run a command", note: "The terminal, full screen", tint: "bg-info/12 text-info", icon: <TerminalIcon className="size-5" /> },
          ].map((row) => (
            <button key={row.label} type="button" className="flex h-16 items-center gap-3 rounded-xl px-2 text-left hover:bg-surface-panel">
              <span className={`grid size-10 place-items-center rounded-xl ${row.tint}`}>{row.icon}</span>
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] font-act text-foreground">{row.label}</span>
                <span className="text-[13px] font-read text-muted-foreground">{row.note}</span>
              </span>
            </button>
          ))}
        </div>
      </Block>
    </>
  )
}

export { PlaygroundBlocks, PlaygroundComponents }
