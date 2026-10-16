import * as React from "react"
import { ArrowUpRight, Moon, Sun } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Logo, LogoMark, LogoText } from "@/components/ui/logo"
import { Toaster } from "@/components/ui/sonner"
import { TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

import { Colour, Motion, Shape, Type } from "./ds/foundations"
import { Migration } from "./ds/migration"
import { Group, ThemeVersion } from "./ds/parts"
import { PlaygroundBlocks, PlaygroundComponents } from "./ds/pg-blocks"
import { Actions, Conversation, Display, Feedback, Forms, Navigation, Overlays } from "./ds/shadcn-blocks"
import { DisplayMore, FormsMore, NavigationMore } from "./ds/shadcn-more"
import { SITE } from "./ds/site"

type NavEntry = { id: string; title: string }
type NavGroup = { id: string; title: string; entries: NavEntry[] }

/* The side nav, read off the page once it is drawn, so a new block needs no
   second list to keep in step with it. */
function useNav() {
  const [groups, setGroups] = React.useState<NavGroup[]>([])
  React.useEffect(() => {
    const found = [...document.querySelectorAll<HTMLElement>("[data-ds-group]")].map((g) => ({
      id: g.id,
      title: g.dataset.dsGroup ?? g.id,
      entries: [...g.querySelectorAll<HTMLElement>("[data-ds-block], [data-ds-section]")].map((b) => ({
        id: b.id,
        title: b.querySelector("h4")?.textContent ?? b.id,
      })),
    }))
    setGroups(found)
  }, [])
  return groups
}

/* Which entry is on screen, for the nav's current mark */
function useCurrent(ids: string[]) {
  const [current, setCurrent] = React.useState("")
  React.useEffect(() => {
    if (!ids.length) return
    const seen = new Map<string, boolean>()
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => seen.set(e.target.id, e.isIntersecting))
        const first = ids.find((id) => seen.get(id))
        if (first) setCurrent(first)
      },
      { rootMargin: "-80px 0px -60% 0px" }
    )
    ids.forEach((id) => {
      const el = document.getElementById(id)
      if (el) io.observe(el)
    })
    return () => io.disconnect()
  }, [ids])
  return current
}

function readTheme(): "dark" | "light" {
  try {
    return localStorage.getItem("ds-theme") === "light" ? "light" : "dark"
  } catch {
    return "dark"
  }
}

function Nav({ groups, current, onPick }: { groups: NavGroup[]; current: string; onPick?: () => void }) {
  return (
    <nav aria-label="Contents" className="flex flex-col gap-6">
      {groups.map((g) => (
        <div key={g.id}>
          <a
            href={`#${g.id}`}
            onClick={onPick}
            className="block py-1 text-caption font-act text-foreground hover:text-brand-purple"
          >
            {g.title}
          </a>
          <ul className="mt-1 flex flex-col border-l border-border">
            {g.entries.map((e) => (
              <li key={e.id}>
                <a
                  href={`#${e.id}`}
                  onClick={onPick}
                  aria-current={current === e.id ? "location" : undefined}
                  className={cn(
                    "-ml-px block border-l py-1.5 pl-3 text-caption font-read transition-colors",
                    current === e.id
                      ? "border-brand-purple text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground"
                  )}
                >
                  {e.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  )
}

function App() {
  const [theme, setTheme] = React.useState<"dark" | "light">(readTheme)
  const [version, setVersion] = React.useState(0)
  const groups = useNav()
  const ids = React.useMemo(() => groups.flatMap((g) => g.entries.map((e) => e.id)), [groups])
  const current = useCurrent(ids)
  const [menuOpen, setMenuOpen] = React.useState(false)

  React.useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    try {
      localStorage.setItem("ds-theme", theme)
    } catch {
      /* a private window keeps no preference, which is fine */
    }
    setVersion((v) => v + 1)
  }, [theme])

  /* Tells a snapshot the page is drawn: fonts in, swatches read */
  React.useEffect(() => {
    document.fonts.ready.then(() => {
      requestAnimationFrame(() => document.documentElement.setAttribute("data-ds-ready", ""))
    })
  }, [])

  const counts = React.useMemo(() => {
    const all = groups.flatMap((g) => g.entries)
    return all.length
  }, [groups])

  return (
    <ThemeVersion.Provider value={version}>
      <TooltipProvider delayDuration={200}>
        <header data-ds-header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 md:px-8">
            <Logo>
              <LogoMark />
              <LogoText>Playground</LogoText>
            </Logo>
            <span className="hidden text-control font-read text-muted-foreground sm:inline">Design system</span>
            <Badge variant="outline" className="font-label">v0</Badge>
            <div className="ml-auto flex items-center gap-1">
              <a
                href="/#app"
                className="hidden h-9 items-center gap-1 rounded-control px-3 text-control font-act text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground md:inline-flex"
              >
                Product, with Studio
                <ArrowUpRight className="size-4" />
              </a>
              <button
                type="button"
                onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
                aria-label={theme === "dark" ? "Show on paper" : "Show in the product"}
                title={theme === "dark" ? "Show on paper" : "Show in the product"}
                className="grid size-11 place-items-center rounded-control text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
              </button>
            </div>
          </div>
        </header>

        <div className="mx-auto flex max-w-7xl gap-12 px-4 md:px-8">
          <aside data-ds-aside className="sticky top-14 hidden h-[calc(100vh-3.5rem)] w-56 shrink-0 overflow-y-auto py-10 lg:block">
            <Nav groups={groups} current={current} />
          </aside>

          <main className="min-w-0 flex-1 pb-32">
            <section className="pt-14 pb-4">
              <h1 className="font-heading text-4xl font-headline tracking-tight text-foreground md:text-5xl">
                Playground design system
              </h1>
              <p className="mt-4 max-w-2xl text-body font-read text-muted-foreground">
                shadcn/ui and Tailwind, dressed in Playground's tokens. Stock shadcn where it fits. Our own
                components where Playground does something shadcn does not. Ours are built the same way and install the same way.
              </p>
              <div className="mt-8 grid max-w-3xl gap-px overflow-hidden rounded-card border border-border bg-border sm:grid-cols-3">
                <Fact value="60" label="shadcn components, restyled by tokens" />
                <Fact value={String(counts || "")} label="blocks on this page" />
                <Fact value="1" label="registry for ours" href={`${SITE}/r/registry.json`} />
              </div>
              <details
                open={menuOpen}
                onToggle={(e) => setMenuOpen((e.target as HTMLDetailsElement).open)}
                className="mt-8 rounded-card border border-border lg:hidden"
              >
                <summary className="cursor-pointer px-4 py-3 text-control font-act text-foreground">Contents</summary>
                <div className="border-t border-border p-4">
                  <Nav groups={groups} current={current} onPick={() => setMenuOpen(false)} />
                </div>
              </details>
            </section>

            <Group id="foundations" title="Foundations" note="The tokens every component reads. Change one here, or in Studio, and everything that uses it follows.">
              <Colour />
              <Type />
              <Shape />
              <Motion />
            </Group>

            <Group id="playground" title="Playground components" note="What shadcn does not have, or where ours does more. Each is one file in components/ui, with compound parts, data-slot on every part and cva variants. Install one with the line under its name.">
              <PlaygroundComponents />
            </Group>

            <Group id="blocks" title="Playground blocks" note="Screens' worth of parts, put together from the components above and shadcn's. A block is a starting point to copy, not a component to configure.">
              <PlaygroundBlocks />
            </Group>

            <Group id="actions" title="Actions">
              <Actions />
            </Group>
            <Group id="forms" title="Forms">
              <Forms />
              <FormsMore />
            </Group>
            <Group id="display" title="Display">
              <Display />
              <DisplayMore />
            </Group>
            <Group id="feedback" title="Feedback">
              <Feedback />
            </Group>
            <Group id="overlays" title="Overlays">
              <Overlays />
            </Group>
            <Group id="navigation" title="Navigation and layout">
              <Navigation />
              <NavigationMore />
            </Group>
            <Group id="conversation" title="The assistant's conversation">
              <Conversation />
            </Group>

            <Group id="migration" title="Moving client-v2" note="How today's styled-components UI maps onto this system, one component at a time.">
              <Migration />
            </Group>
          </main>
        </div>
        <Toaster theme={theme} position="bottom-center" />
      </TooltipProvider>
    </ThemeVersion.Provider>
  )
}

function Fact({ value, label, href }: { value: string; label: string; href?: string }) {
  const body = (
    <>
      <div className="font-heading text-display font-headline text-foreground">{value}</div>
      <div className="mt-1 text-caption font-read text-muted-foreground">{label}</div>
    </>
  )
  return href ? (
    <a href={href} className="block bg-background p-5 transition-colors hover:bg-surface">
      {body}
    </a>
  ) : (
    <div className="bg-background p-5">{body}</div>
  )
}

export default App
