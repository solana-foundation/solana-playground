import { BookOpen, FileCode2, FlaskConical, Rocket } from "lucide-react"
import { Bar, BarChart, CartesianGrid, XAxis } from "recharts"

import { AspectRatio } from "@/components/ui/aspect-ratio"
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious } from "@/components/ui/carousel"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from "@/components/ui/combobox"
import {
  NavigationMenu,
  NavigationMenuContent,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  NavigationMenuTrigger,
} from "@/components/ui/navigation-menu"
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
} from "@/components/ui/sidebar"

import { Block } from "./parts"

const SAMPLES = ["Counter", "Tip jar", "Voting", "Token faucet", "Hello Anchor", "Escrow"]

function FormsMore() {
  return (
    <Block id="combobox" title="Combobox" note="A field that searches as you type, for a list too long to scroll: samples, programs, accounts.">
      <Combobox items={SAMPLES}>
        <ComboboxInput placeholder="Find a sample" className="w-64" />
        <ComboboxContent>
          <ComboboxEmpty>No sample by that name.</ComboboxEmpty>
          <ComboboxList>
            {(item: string) => (
              <ComboboxItem key={item} value={item}>
                {item}
              </ComboboxItem>
            )}
          </ComboboxList>
        </ComboboxContent>
      </Combobox>
    </Block>
  )
}

const deploys = [
  { day: "Mon", deploys: 12 },
  { day: "Tue", deploys: 19 },
  { day: "Wed", deploys: 15 },
  { day: "Thu", deploys: 27 },
  { day: "Fri", deploys: 22 },
  { day: "Sat", deploys: 9 },
  { day: "Sun", deploys: 7 },
]
const deploysConfig = { deploys: { label: "Deploys", color: "var(--chart-1)" } } satisfies ChartConfig

function DisplayMore() {
  return (
    <>
      <Block id="chart" title="Chart" note="Numbers over time, in the chart tokens. The first series takes the accent." className="block">
        <ChartContainer config={deploysConfig} className="h-48 w-full max-w-lg">
          <BarChart accessibilityLayer data={deploys}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
            <ChartTooltip cursor={false} content={<ChartTooltipContent hideLabel />} />
            <Bar dataKey="deploys" fill="var(--color-deploys)" radius={6} />
          </BarChart>
        </ChartContainer>
      </Block>

      <Block id="carousel" title="Carousel and aspect ratio" note="A row of things to flick through, each held to one shape. Samples in the gallery, frames in a tutorial.">
        <div className="px-12">
          <Carousel className="w-44 sm:w-64" opts={{ align: "start" }}>
            <CarouselContent>
              {SAMPLES.slice(0, 4).map((name) => (
                <CarouselItem key={name}>
                  <AspectRatio ratio={4 / 3} className="grid place-items-center rounded-panel border border-border bg-surface">
                    <span className="text-control font-act text-foreground">{name}</span>
                  </AspectRatio>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious />
            <CarouselNext />
          </Carousel>
        </div>
      </Block>
    </>
  )
}

function NavigationMore() {
  return (
    <>
      <Block id="navigation-menu" title="Navigation menu" note="The site's own menus, on the landing and the docs. Not for the workspace.">
        <NavigationMenu>
          <NavigationMenuList>
            <NavigationMenuItem>
              <NavigationMenuTrigger>Learn</NavigationMenuTrigger>
              <NavigationMenuContent>
                <ul className="grid w-72 gap-1 p-1">
                  {[
                    ["Tutorials", "Guided, with a check at every step"],
                    ["Samples", "Programs to open and change"],
                    ["Docs", "Anchor, and Solana itself"],
                  ].map(([t, d]) => (
                    <li key={t}>
                      <NavigationMenuLink href="#c-navigation-menu" className="flex-col items-start gap-0.5">
                        <span className="text-control font-act text-foreground">{t}</span>
                        <span className="text-caption font-read text-muted-foreground">{d}</span>
                      </NavigationMenuLink>
                    </li>
                  ))}
                </ul>
              </NavigationMenuContent>
            </NavigationMenuItem>
            <NavigationMenuItem>
              <NavigationMenuLink href="#c-navigation-menu">Pricing</NavigationMenuLink>
            </NavigationMenuItem>
          </NavigationMenuList>
        </NavigationMenu>
      </Block>

      <Block id="sidebar" title="Sidebar" note="The workspace's left column: the project, its files and the lessons. It folds to icons, and becomes a sheet on a phone." className="block">
        <SidebarProvider className="min-h-0 w-fit overflow-hidden rounded-panel border border-border">
          <Sidebar collapsible="none" className="h-72">
            <SidebarContent>
              <SidebarGroup>
                <SidebarGroupLabel>hello_anchor</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton isActive><FileCode2 />lib.rs</SidebarMenuButton>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton><FlaskConical />Tests</SidebarMenuButton>
                    <SidebarMenuBadge>3</SidebarMenuBadge>
                  </SidebarMenuItem>
                  <SidebarMenuItem>
                    <SidebarMenuButton><Rocket />Deploys</SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
              <SidebarGroup>
                <SidebarGroupLabel>Learn</SidebarGroupLabel>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton><BookOpen />Hello Anchor</SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroup>
            </SidebarContent>
          </Sidebar>
        </SidebarProvider>
      </Block>
    </>
  )
}

export { DisplayMore, FormsMore, NavigationMore }
