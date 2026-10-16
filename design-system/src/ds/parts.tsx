import * as React from "react"
import { Check, Copy } from "lucide-react"

import { cn } from "@/lib/utils"

import { install } from "./site"

/*
 * The page's own parts. A component block is what Studio reads: an element
 * with data-ds-block and an id that starts with "c-", a title in its h4,
 * and a first .row whose children are the specimens the Add tab offers.
 * Anything after that row is for people reading the page.
 */

type Source = "shadcn" | "playground" | "block"

const SOURCE_LABEL: Record<Source, string> = {
  shadcn: "shadcn",
  playground: "Playground component",
  block: "Playground block",
}

function Block({
  id,
  title,
  note,
  children,
  more,
  className,
  source = "shadcn",
  registry,
}: {
  id: string
  title: string
  note: string
  children: React.ReactNode
  more?: React.ReactNode
  className?: string
  source?: Source
  /** the registry item that installs it, when it is ours */
  registry?: string
}) {
  return (
    <section data-ds-block data-source={source} id={`c-${id}`} className="scroll-mt-20 border-t border-border py-10">
      <h4 className="font-heading text-2xl font-headline tracking-tight text-foreground">{title}</h4>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <span
          className={cn(
            "text-caption font-label",
            source === "shadcn" ? "text-subtle" : "text-brand-purple"
          )}
        >
          {SOURCE_LABEL[source]}
        </span>
        {registry && <InstallLine name={registry} />}
      </div>
      <p className="mt-2 max-w-2xl text-body font-read text-muted-foreground">{note}</p>
      <div
        className={cn(
          "row mt-6 flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface-base p-6",
          className
        )}
      >
        {children}
      </div>
      {more}
    </section>
  )
}

/** The install command for one of ours, with a copy button */
function InstallLine({ name }: { name: string }) {
  const [copied, setCopied] = React.useState(false)
  const cmd = install(name)
  return (
    <span className="inline-flex min-w-0 max-w-full items-center gap-1">
      <code className="truncate font-mono text-[12px] text-muted-foreground">{cmd}</code>
      <button
        type="button"
        aria-label={copied ? "Copied" : "Copy the install command"}
        className="grid size-7 shrink-0 place-items-center rounded-control text-subtle transition-colors hover:bg-surface-hover hover:text-foreground"
        onClick={() => {
          navigator.clipboard?.writeText(cmd).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1400)
          })
        }}
      >
        {copied ? <Check className="size-3.5 text-success" /> : <Copy className="size-3.5" />}
      </button>
    </span>
  )
}

/** A second or third line of specimens, for people rather than for Studio */
function More({ label, children, className }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className="mt-3">
      <div className="mb-2 text-caption font-label text-subtle">{label}</div>
      <div className={cn("ds-row flex flex-wrap items-center gap-3 rounded-card border border-border p-6", className)}>
        {children}
      </div>
    </div>
  )
}

/** A run of blocks under one heading; the side nav is built from these */
function Group({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note?: string
  children: React.ReactNode
}) {
  return (
    <section data-ds-group={title} id={id} className="scroll-mt-20 pt-14">
      <h3 className="font-heading text-3xl font-headline tracking-tight text-foreground">{title}</h3>
      {note && <p className="mt-2 max-w-2xl text-body font-read text-muted-foreground">{note}</p>}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/** A foundations section: tokens rather than components */
function Section({
  id,
  title,
  note,
  children,
}: {
  id: string
  title: string
  note: string
  children: React.ReactNode
}) {
  return (
    <section id={id} data-ds-section={title} className="scroll-mt-20 border-t border-border py-10">
      <h4 className="font-heading text-2xl font-headline tracking-tight text-foreground">{title}</h4>
      <p className="mt-2 max-w-2xl text-body font-read text-muted-foreground">{note}</p>
      <div className="mt-6">{children}</div>
    </section>
  )
}

/* The value of a token, read off the page as it is drawn now, so it follows
   the theme and whatever Studio has changed. Empty until the page runs. */
function useTokenValue(token: string, version: number) {
  const [value, setValue] = React.useState("")
  React.useEffect(() => {
    setValue(getComputedStyle(document.documentElement).getPropertyValue(token).trim())
  }, [token, version])
  return value
}

const ThemeVersion = React.createContext(0)

function Swatch({ token, label }: { token: string; label?: string }) {
  const version = React.useContext(ThemeVersion)
  const value = useTokenValue(token, version)
  return (
    <div data-ds-token={token} className="flex min-w-0 flex-col gap-2">
      <div
        className="h-16 rounded-panel border border-border"
        style={{ background: `var(${token})` }}
      />
      <div className="min-w-0">
        <div className="truncate text-caption font-act text-foreground">{label ?? token.slice(2)}</div>
        <div className="truncate font-mono text-[11px] text-subtle">
          {token}
          {value ? ` · ${value}` : ""}
        </div>
      </div>
    </div>
  )
}

function SwatchGrid({ title, tokens }: { title: string; tokens: Array<[string, string?]> }) {
  return (
    <div className="mb-8">
      <div className="mb-3 text-control font-act text-foreground">{title}</div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-6">
        {tokens.map(([t, l]) => (
          <Swatch key={t} token={t} label={l} />
        ))}
      </div>
    </div>
  )
}

/** A row in a token table: what it is called, what it looks like, what it is */
function TokenRow({ name, sample, detail }: { name: string; sample: React.ReactNode; detail: string }) {
  return (
    <div className="grid gap-2 border-b border-border py-4 last:border-b-0 md:grid-cols-[12rem_1fr_14rem] md:items-center md:gap-6">
      <code className="font-mono text-caption text-muted-foreground">{name}</code>
      <div className="min-w-0">{sample}</div>
      <div className="text-caption font-read text-subtle">{detail}</div>
    </div>
  )
}

export { Block, Group, InstallLine, More, Section, Swatch, SwatchGrid, ThemeVersion, TokenRow }
