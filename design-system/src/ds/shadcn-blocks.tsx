import {
  Bell,
  ChevronRight,
  FileCode2,
  FolderOpen,
  GitBranch,
  Hammer,
  MoreHorizontal,
  Rocket,
  Search,
  Settings,
  Share2,
  Sparkles,
} from "lucide-react"
import { toast } from "sonner"

import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { Attachment, AttachmentContent, AttachmentDescription, AttachmentMedia, AttachmentTitle } from "@/components/ui/attachment"
import { Avatar, AvatarFallback, AvatarGroup } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { Bubble, BubbleContent } from "@/components/ui/bubble"
import { Button } from "@/components/ui/button"
import { ButtonGroup } from "@/components/ui/button-group"
import { Calendar } from "@/components/ui/calendar"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandShortcut,
} from "@/components/ui/command"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerTrigger,
} from "@/components/ui/drawer"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card"
import { Input } from "@/components/ui/input"
import { InputGroup, InputGroupAddon, InputGroupInput, InputGroupText } from "@/components/ui/input-group"
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp"
import { Item, ItemActions, ItemContent, ItemDescription, ItemMedia, ItemTitle } from "@/components/ui/item"
import { Kbd, KbdGroup } from "@/components/ui/kbd"
import { Label } from "@/components/ui/label"
import { Marker, MarkerContent } from "@/components/ui/marker"
import { Menubar, MenubarContent, MenubarItem, MenubarMenu, MenubarShortcut, MenubarTrigger } from "@/components/ui/menubar"
import { Message, MessageAvatar, MessageContent, MessageGroup } from "@/components/ui/message"
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select"
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Slider } from "@/components/ui/slider"
import { Spinner } from "@/components/ui/spinner"
import { Switch } from "@/components/ui/switch"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Textarea } from "@/components/ui/textarea"
import { Toggle } from "@/components/ui/toggle"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"

import { Block, More } from "./parts"

/* ── actions ──────────────────────────────────────────────────────────── */

function Actions() {
  return (
    <>
      <Block
        id="button"
        title="Button"
        note="One filled button per screen, in the accent. Outline and ghost for everything around it. Destructive is kept for the last confirm."
        more={
          <>
            <More label="Sizes">
              <Button size="xs">Extra small</Button>
              <Button size="sm">Small</Button>
              <Button>Default</Button>
              <Button size="lg">Large</Button>
              <Button size="icon" aria-label="Settings"><Settings /></Button>
            </More>
            <More label="With an icon, and states">
              <Button><Rocket data-icon="inline-start" />Deploy</Button>
              <Button variant="outline"><Hammer data-icon="inline-start" />Build</Button>
              <Button disabled>Disabled</Button>
              <Button variant="outline" disabled><Spinner />Building</Button>
            </More>
          </>
        }
      >
        <Button>Deploy</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="destructive">Close program</Button>
        <Button variant="link">Open docs</Button>
      </Block>

      <Block id="button-group" title="Button group" note="Buttons that act on one thing, joined so they read as one control.">
        <ButtonGroup>
          <Button variant="outline"><Hammer data-icon="inline-start" />Build</Button>
          <Button variant="outline"><Rocket data-icon="inline-start" />Deploy</Button>
          <Button variant="outline" size="icon" aria-label="More"><MoreHorizontal /></Button>
        </ButtonGroup>
        <ButtonGroup>
          <Button variant="outline">Devnet</Button>
          <Button variant="outline">Testnet</Button>
        </ButtonGroup>
      </Block>

      <Block id="toggle" title="Toggle and toggle group" note="A switch you press, for a view or a mode rather than a setting.">
        <Toggle aria-label="Show the terminal"><FileCode2 />Terminal</Toggle>
        <ToggleGroup type="single" defaultValue="code" variant="outline">
          <ToggleGroupItem value="code">Code</ToggleGroupItem>
          <ToggleGroupItem value="split">Split</ToggleGroupItem>
          <ToggleGroupItem value="preview">Preview</ToggleGroupItem>
        </ToggleGroup>
      </Block>

      <Block id="kbd" title="Keyboard key" note="Shortcuts, named the way the key reads on a Mac.">
        <KbdGroup><Kbd>⌘</Kbd><Kbd>K</Kbd></KbdGroup>
        <KbdGroup><Kbd>⌘</Kbd><Kbd>B</Kbd></KbdGroup>
        <Kbd>Esc</Kbd>
      </Block>
    </>
  )
}

/* ── forms ────────────────────────────────────────────────────────────── */

function Forms() {
  return (
    <>
      <Block id="input" title="Input" note="A field on the raised surface, with the accent as its focus ring.">
        <Input className="w-64" placeholder="Program name" />
        <Input className="w-64" defaultValue="hello_anchor" />
        <Input className="w-64" placeholder="Disabled" disabled />
      </Block>

      <Block id="input-group" title="Input group" note="A field with what belongs to it: a prefix, a unit, an action.">
        <InputGroup className="w-80">
          <InputGroupAddon><Search /></InputGroupAddon>
          <InputGroupInput placeholder="Search tutorials" />
        </InputGroup>
        <InputGroup className="w-72">
          <InputGroupInput placeholder="0.5" />
          <InputGroupAddon align="inline-end"><InputGroupText>SOL</InputGroupText></InputGroupAddon>
        </InputGroup>
      </Block>

      <Block id="textarea" title="Textarea" note="Longer text: a program's description, a note to the assistant.">
        <Textarea className="w-80" placeholder="What should this program do?" />
      </Block>

      <Block id="field" title="Field" note="A label, the control and one line of help, laid out the same way everywhere.">
        <Field className="w-80">
          <FieldLabel htmlFor="rpc">Custom RPC</FieldLabel>
          <Input id="rpc" placeholder="https://" />
          <FieldDescription>Used for reads, deploys and the test UI.</FieldDescription>
        </Field>
      </Block>

      <Block id="select" title="Select" note="One choice from a short list. For a long one, use Command.">
        <Select defaultValue="1.2">
          <SelectTrigger className="w-44" aria-label="Anchor version"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="1.2">Anchor 1.2</SelectItem>
            <SelectItem value="1.1.2">Anchor 1.1.2</SelectItem>
            <SelectItem value="0.29">Anchor 0.29, legacy</SelectItem>
          </SelectContent>
        </Select>
        <NativeSelect className="w-44" aria-label="Framework">
          <NativeSelectOption value="anchor">Anchor</NativeSelectOption>
          <NativeSelectOption value="native">Native</NativeSelectOption>
          <NativeSelectOption value="seahorse">Seahorse</NativeSelectOption>
        </NativeSelect>
      </Block>

      <Block id="checkbox" title="Checkbox, radio and switch" note="Checkbox for a list of yes-or-no. Radio for one of a few. Switch for a setting that applies at once.">
        <div className="flex items-center gap-2"><Checkbox id="fmt" defaultChecked /><Label htmlFor="fmt">Format on save</Label></div>
        <RadioGroup defaultValue="devnet" className="flex gap-4">
          <div className="flex items-center gap-2"><RadioGroupItem value="devnet" id="r1" /><Label htmlFor="r1">Devnet</Label></div>
          <div className="flex items-center gap-2"><RadioGroupItem value="testnet" id="r2" /><Label htmlFor="r2">Testnet</Label></div>
        </RadioGroup>
        <div className="flex items-center gap-2"><Switch id="vim" /><Label htmlFor="vim">Vim mode</Label></div>
      </Block>

      <Block id="slider" title="Slider" note="A value on a range: font size, compute units.">
        <Slider className="w-64" defaultValue={[14]} min={11} max={20} aria-label="Font size" />
      </Block>

      <Block id="input-otp" title="One-time code" note="A code sent to confirm who you are.">
        <InputOTP maxLength={6}>
          <InputOTPGroup>
            {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
          </InputOTPGroup>
        </InputOTP>
      </Block>

      <Block id="calendar" title="Calendar" note="A date: when a program was deployed, when a streak started.">
        <Calendar mode="single" className="rounded-panel border border-border" />
      </Block>
    </>
  )
}

/* ── display ──────────────────────────────────────────────────────────── */

function Display() {
  return (
    <>
      <Block id="badge" title="Badge" note="A short label on something: its level, its network, its state.">
        <Badge>New</Badge>
        <Badge variant="secondary">Beginner</Badge>
        <Badge variant="outline">Devnet</Badge>
        <Badge variant="destructive">Failed</Badge>
      </Block>

      <Block id="card" title="Card" note="A group of things about one subject. A hairline, not a shadow.">
        <Card className="w-80">
          <CardHeader>
            <CardTitle>Counter</CardTitle>
            <CardDescription>A program that counts, and the tests that prove it.</CardDescription>
          </CardHeader>
          <CardContent className="text-caption text-muted-foreground">Anchor 1.2 · 3 instructions</CardContent>
          <CardFooter className="gap-2">
            <Button size="sm">Open</Button>
            <Button size="sm" variant="ghost">Share</Button>
          </CardFooter>
        </Card>
      </Block>

      <Block id="item" title="Item" note="A row with an icon, a title, a line under it and an action. Files, programs, tutorials.">
        <Item variant="outline" className="w-96">
          <ItemMedia variant="icon"><FolderOpen /></ItemMedia>
          <ItemContent>
            <ItemTitle>hello_anchor</ItemTitle>
            <ItemDescription>Edited 2 minutes ago</ItemDescription>
          </ItemContent>
          <ItemActions><Button size="sm" variant="outline">Open</Button></ItemActions>
        </Item>
      </Block>

      <Block id="avatar" title="Avatar" note="A person, from their GitHub picture or their initials.">
        <Avatar><AvatarFallback>NT</AvatarFallback></Avatar>
        <AvatarGroup>
          <Avatar><AvatarFallback>AL</AvatarFallback></Avatar>
          <Avatar><AvatarFallback>KB</AvatarFallback></Avatar>
          <Avatar><AvatarFallback>SO</AvatarFallback></Avatar>
        </AvatarGroup>
      </Block>

      <Block id="table" title="Table" note="Rows to compare. On a phone, a table of more than three columns becomes a list." className="block">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Program</TableHead>
              <TableHead>Network</TableHead>
              <TableHead>Deployed</TableHead>
              <TableHead className="text-right">Closes</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            <TableRow>
              <TableCell className="font-mono">hello_anchor</TableCell>
              <TableCell>Devnet</TableCell>
              <TableCell>Today, 14:02</TableCell>
              <TableCell className="text-right">in 7 days</TableCell>
            </TableRow>
            <TableRow>
              <TableCell className="font-mono">counter</TableCell>
              <TableCell>Testnet</TableCell>
              <TableCell>Yesterday</TableCell>
              <TableCell className="text-right">in 6 days</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Block>

      <Block id="accordion" title="Accordion" note="Sections that fold, when only one needs to be open at a time." className="block">
        <Accordion type="single" collapsible defaultValue="kora" className="w-full max-w-md">
          <AccordionItem value="kora">
            <AccordionTrigger>Why is my deploy free?</AccordionTrigger>
            <AccordionContent>Kora pays the rent on devnet and testnet, so a first deploy needs no SOL.</AccordionContent>
          </AccordionItem>
          <AccordionItem value="close">
            <AccordionTrigger>Why did my program close?</AccordionTrigger>
            <AccordionContent>Programs that sit unused for 7 days are closed. Redeploy it any time.</AccordionContent>
          </AccordionItem>
        </Accordion>
      </Block>

      <Block id="collapsible" title="Collapsible" note="One thing that folds: the details under a build result.">
        <Collapsible className="w-80">
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm"><ChevronRight data-icon="inline-start" />Build details</Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="px-2 text-caption text-muted-foreground">11.8 s · Anchor 1.2 · Solana 3.1</CollapsibleContent>
        </Collapsible>
      </Block>

      <Block id="separator" title="Separator" note="One hairline, the same everywhere.">
        <div className="flex h-6 items-center gap-3 text-caption">
          <span>Write</span><Separator orientation="vertical" /><span>Build</span><Separator orientation="vertical" /><span>Deploy</span>
        </div>
      </Block>

      <Block id="empty" title="Empty state" note="What a place is for, before there is anything in it, and the one action that fills it." className="block">
        <Empty className="border border-dashed border-border">
          <EmptyHeader>
            <EmptyMedia variant="icon"><Rocket /></EmptyMedia>
            <EmptyTitle>Nothing deployed yet</EmptyTitle>
            <EmptyDescription>Build your program, then deploy it to devnet with 0 SOL.</EmptyDescription>
          </EmptyHeader>
          <EmptyContent><Button>Build</Button></EmptyContent>
        </Empty>
      </Block>
    </>
  )
}

/* ── feedback ─────────────────────────────────────────────────────────── */

function Feedback() {
  return (
    <>
      <Block id="alert" title="Alert" note="A message about the page as a whole. Say what happened and what to do." className="block">
        <Alert className="max-w-md">
          <Bell />
          <AlertTitle>Your program closes in 2 days</AlertTitle>
          <AlertDescription>It has not been used for 5 days. Run a transaction to keep it.</AlertDescription>
        </Alert>
        <Alert variant="destructive" className="mt-3 max-w-md">
          <AlertTitle>Deploy failed</AlertTitle>
          <AlertDescription>The paymaster refused this deploy. Try a smaller program.</AlertDescription>
        </Alert>
      </Block>

      <Block id="sonner" title="Toast" note="A quiet confirmation that goes away by itself. Press the button to see one.">
        <Button variant="outline" onClick={() => toast("Copied the program id")}>Show a toast</Button>
        <Button variant="outline" onClick={() => toast.success("Deployed to devnet")}>Success toast</Button>
      </Block>

      <Block id="progress" title="Progress, spinner and skeleton" note="Progress for a known amount, a spinner for an unknown wait, a skeleton for content on its way.">
        <Progress value={62} className="w-56" aria-label="Writing the program" />
        <Spinner />
        <div className="flex w-56 flex-col gap-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Block>
    </>
  )
}

/* ── overlays ─────────────────────────────────────────────────────────── */

function Overlays() {
  return (
    <>
      <Block id="dialog" title="Dialog" note="A task that needs the whole of your attention. The title in the headline face, the actions at the foot.">
        <Dialog>
          <DialogTrigger asChild><Button variant="outline"><Share2 data-icon="inline-start" />Share project</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Share through GitHub</DialogTitle>
              <DialogDescription>We save the project as a gist. Anyone with the link can open it.</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="ghost">Cancel</Button>
              <Button><Share2 data-icon="inline-start" />Create gist</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </Block>

      <Block id="alert-dialog" title="Alert dialog" note="A question that cannot be undone, asked plainly.">
        <AlertDialog>
          <AlertDialogTrigger asChild><Button variant="destructive">Delete project</Button></AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete hello_anchor?</AlertDialogTitle>
              <AlertDialogDescription>The files go. A program already deployed stays on devnet.</AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Keep it</AlertDialogCancel>
              <AlertDialogAction>Delete</AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </Block>

      <Block id="sheet" title="Sheet and drawer" note="A sheet slides in from the side on desktop. On a phone the drawer rises from the bottom, within thumb reach.">
        <Sheet>
          <SheetTrigger asChild><Button variant="outline">Open settings</Button></SheetTrigger>
          <SheetContent>
            <SheetHeader>
              <SheetTitle>Settings</SheetTitle>
              <SheetDescription>Editor, network and the assistant.</SheetDescription>
            </SheetHeader>
          </SheetContent>
        </Sheet>
        <Drawer>
          <DrawerTrigger asChild><Button variant="outline">Open drawer</Button></DrawerTrigger>
          <DrawerContent>
            <DrawerHeader>
              <DrawerTitle>Deploy to devnet</DrawerTitle>
              <DrawerDescription>Kora pays the rent. It needs 0 SOL.</DrawerDescription>
            </DrawerHeader>
            <DrawerFooter><Button>Deploy</Button></DrawerFooter>
          </DrawerContent>
        </Drawer>
      </Block>

      <Block id="dropdown-menu" title="Dropdown and context menu" note="Actions on one thing. The context menu is how the editor offers Explain and Fix on a selection.">
        <DropdownMenu>
          <DropdownMenuTrigger asChild><Button variant="outline">Project<MoreHorizontal data-icon="inline-end" /></Button></DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuLabel>hello_anchor</DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem>Rename<DropdownMenuShortcut>F2</DropdownMenuShortcut></DropdownMenuItem>
            <DropdownMenuItem>Duplicate</DropdownMenuItem>
            <DropdownMenuItem>Share through GitHub</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <ContextMenu>
          <ContextMenuTrigger className="grid h-16 w-64 place-items-center rounded-panel border border-dashed border-border-strong text-caption text-muted-foreground">
            Right-click here
          </ContextMenuTrigger>
          <ContextMenuContent>
            <ContextMenuItem><Sparkles />Explain selection<ContextMenuShortcut>⌘E</ContextMenuShortcut></ContextMenuItem>
            <ContextMenuItem><Sparkles />Fix with AI</ContextMenuItem>
            <ContextMenuSeparator />
            <ContextMenuItem>Copy</ContextMenuItem>
          </ContextMenuContent>
        </ContextMenu>
      </Block>

      <Block id="popover" title="Popover, hover card and tooltip" note="A tooltip names a control. A hover card previews a thing. A popover holds a small task.">
        <Popover>
          <PopoverTrigger asChild><Button variant="outline">Network</Button></PopoverTrigger>
          <PopoverContent className="w-64 text-caption">Devnet through Kora. Deploys need 0 SOL and close after 7 idle days.</PopoverContent>
        </Popover>
        <HoverCard>
          <HoverCardTrigger asChild><Button variant="link">@solana-playground</Button></HoverCardTrigger>
          <HoverCardContent className="w-64 text-caption">12 projects · 34 deploys · 5 tutorials finished</HoverCardContent>
        </HoverCard>
        <Tooltip>
          <TooltipTrigger asChild><Button variant="ghost" size="icon" aria-label="Build"><Hammer /></Button></TooltipTrigger>
          <TooltipContent>Build <Kbd>⌘B</Kbd></TooltipContent>
        </Tooltip>
      </Block>

      <Block id="command" title="Command" note="Search and act from the keyboard: files, tutorials, commands." className="block">
        <Command className="max-w-md rounded-panel border border-border">
          <CommandInput placeholder="Type a command or search" />
          <CommandList>
            <CommandEmpty>Nothing found.</CommandEmpty>
            <CommandGroup heading="Actions">
              <CommandItem value="build"><Hammer />Build<CommandShortcut>⌘B</CommandShortcut></CommandItem>
              <CommandItem value="deploy"><Rocket />Deploy to devnet</CommandItem>
              <CommandItem value="share"><GitBranch />Share through GitHub</CommandItem>
            </CommandGroup>
          </CommandList>
        </Command>
      </Block>
    </>
  )
}

/* ── navigation and layout ────────────────────────────────────────────── */

function Navigation() {
  return (
    <>
      <Block id="tabs" title="Tabs" note="Views of one thing. The line variant sits under a panel's head.">
        <Tabs defaultValue="chat">
          <TabsList><TabsTrigger value="chat">Chat</TabsTrigger><TabsTrigger value="sources">Sources</TabsTrigger></TabsList>
          <TabsContent value="chat" className="text-caption text-muted-foreground">Ask about your program.</TabsContent>
          <TabsContent value="sources" className="text-caption text-muted-foreground">Docs the answer used.</TabsContent>
        </Tabs>
        <Tabs defaultValue="files">
          <TabsList variant="line"><TabsTrigger value="files">Files</TabsTrigger><TabsTrigger value="tests">Tests</TabsTrigger><TabsTrigger value="idl">IDL</TabsTrigger></TabsList>
        </Tabs>
      </Block>

      <Block id="breadcrumb" title="Breadcrumb and pagination" note="Where you are, and how to move through a long list.">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem><BreadcrumbLink href="#">Tutorials</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbLink href="#">Hello Anchor</BreadcrumbLink></BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Step 2</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <Pagination className="mx-0 w-auto">
          <PaginationContent>
            <PaginationItem><PaginationPrevious href="#" /></PaginationItem>
            <PaginationItem><PaginationLink href="#" isActive>1</PaginationLink></PaginationItem>
            <PaginationItem><PaginationLink href="#">2</PaginationLink></PaginationItem>
            <PaginationItem><PaginationNext href="#" /></PaginationItem>
          </PaginationContent>
        </Pagination>
      </Block>

      <Block id="menubar" title="Menubar" note="The editor's menus, when the product needs a full set of commands.">
        <Menubar>
          <MenubarMenu>
            <MenubarTrigger>File</MenubarTrigger>
            <MenubarContent>
              <MenubarItem>New file<MenubarShortcut>⌘N</MenubarShortcut></MenubarItem>
              <MenubarItem>Import from GitHub</MenubarItem>
            </MenubarContent>
          </MenubarMenu>
          <MenubarMenu>
            <MenubarTrigger>Build</MenubarTrigger>
            <MenubarContent><MenubarItem>Build<MenubarShortcut>⌘B</MenubarShortcut></MenubarItem></MenubarContent>
          </MenubarMenu>
        </Menubar>
      </Block>

      <Block id="resizable" title="Resizable panels" note="The workspace's columns: files, code and the assistant, each one draggable." className="block">
        <ResizablePanelGroup orientation="horizontal" className="h-32 max-w-2xl rounded-panel border border-border">
          <ResizablePanel defaultSize={25} className="grid place-items-center text-caption text-muted-foreground">Files</ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={50} className="grid place-items-center text-caption text-muted-foreground">Code</ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel defaultSize={25} className="grid place-items-center text-caption text-muted-foreground">Assistant</ResizablePanel>
        </ResizablePanelGroup>
      </Block>

      <Block id="scroll-area" title="Scroll area" note="A long list that scrolls inside its panel, with a quiet thumb.">
        <ScrollArea className="h-32 w-56 rounded-panel border border-border">
          <div className="p-3 text-caption">
            {["lib.rs", "state.rs", "errors.rs", "instructions/mod.rs", "instructions/initialize.rs", "tests/anchor.test.ts", "Anchor.toml", "Cargo.toml"].map((f) => (
              <div key={f} className="py-1 font-mono text-muted-foreground">{f}</div>
            ))}
          </div>
        </ScrollArea>
      </Block>
    </>
  )
}

/* ── the assistant's conversation ─────────────────────────────────────── */

function Conversation() {
  return (
    <>
      <Block id="message" title="Message and bubble" note="The assistant's conversation. Your messages on the right in the accent, its answers on the left on the surface." className="block">
        <MessageGroup className="max-w-xl">
          <Message align="end">
            <MessageContent>
              <Bubble variant="default" align="end"><BubbleContent>Why does my build fail?</BubbleContent></Bubble>
            </MessageContent>
          </Message>
          <Message>
            <MessageAvatar className="size-8"><Sparkles className="size-4" /></MessageAvatar>
            <MessageContent>
              <Bubble variant="secondary"><BubbleContent>initialize is missing its Context. I can add it as a patch you review first.</BubbleContent></Bubble>
            </MessageContent>
          </Message>
        </MessageGroup>
      </Block>

      <Block id="attachment" title="Attachment" note="A file you hand the assistant, and how far along it is.">
        <Attachment>
          <AttachmentMedia><FileCode2 /></AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>lib.rs</AttachmentTitle>
            <AttachmentDescription>Rust · 2 KB</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
        <Attachment state="uploading">
          <AttachmentMedia><Spinner /></AttachmentMedia>
          <AttachmentContent>
            <AttachmentTitle>program.so</AttachmentTitle>
            <AttachmentDescription>Uploading</AttachmentDescription>
          </AttachmentContent>
        </Attachment>
      </Block>

      <Block id="marker" title="Marker" note="A line in the conversation that is not a message: a day, a tool the assistant used." className="block">
        <div className="flex max-w-xl flex-col gap-3">
          <Marker variant="separator"><MarkerContent>Today</MarkerContent></Marker>
          <Marker><Hammer /><MarkerContent>Ran a build · 11.8 s</MarkerContent></Marker>
        </div>
      </Block>
    </>
  )
}

export { Actions, Conversation, Display, Feedback, Forms, Navigation, Overlays }
