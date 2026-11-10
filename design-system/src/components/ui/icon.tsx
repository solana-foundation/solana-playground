import * as React from "react"
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleCheck,
  CircleHelp,
  CircleUserRound,
  CircleX,
  Clock,
  CodeXml,
  Copy,
  Download,
  Droplet,
  Ellipsis,
  EllipsisVertical,
  Eraser,
  Eye,
  File,
  FilePlus,
  Files,
  FlaskConical,
  Folder,
  FolderInput,
  FolderOutput,
  FolderPlus,
  Hammer,
  History,
  Info,
  Link,
  LoaderCircle,
  Lock,
  LogOut,
  Menu,
  MessageSquare,
  MousePointerClick,
  PanelLeft,
  Pencil,
  Pin,
  PinOff,
  Play,
  Plus,
  Rocket,
  RotateCw,
  Search,
  Settings,
  Share,
  Square,
  SquareTerminal,
  Trash2,
  TriangleAlert,
  Upload,
  Wallet,
  Wrench,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"

/* The product's one line icon set. Every glyph sits on a 24 grid with a
   2 px margin, drawn at stroke 1.5 with round caps and joins, inner corners
   of 2. The stroke scales with the size: 1 px at 16, 1.25 at 20, 1.5 at 24,
   so a glyph keeps the weight of Stack Sans beside it (16 with 13 to 15 px
   text, 20 with 16 to 17, 24 alone on a phone bar or an empty state).
   The nav keeps its brand-cut glyphs (brand-icon); third-party marks
   (Anchor, Seahorse, GitHub, languages) stay official. */
const ICONS = {
  // The four stages
  write: CodeXml,
  build: Hammer,
  deploy: Rocket,
  interact: MousePointerClick,
  // State: each pairs with a word, never stands for one alone
  idle: Circle,
  running: LoaderCircle,
  success: CircleCheck,
  warning: TriangleAlert,
  error: CircleX,
  info: Info,
  // Actions
  add: Plus,
  close: X,
  check: Check,
  copy: Copy,
  edit: Pencil,
  delete: Trash2,
  more: Ellipsis,
  "more-vertical": EllipsisVertical,
  search: Search,
  share: Share,
  link: Link,
  external: ArrowUpRight,
  download: Download,
  upload: Upload,
  import: FolderInput,
  export: FolderOutput,
  refresh: RotateCw,
  clear: Eraser,
  run: Play,
  stop: Square,
  test: FlaskConical,
  fix: Wrench,
  airdrop: Droplet,
  pin: Pin,
  unpin: PinOff,
  show: Eye,
  // Direction
  back: ArrowLeft,
  forward: ArrowRight,
  "chevron-left": ChevronLeft,
  "chevron-right": ChevronRight,
  "chevron-up": ChevronUp,
  "chevron-down": ChevronDown,
  // Places and things
  menu: Menu,
  sidebar: PanelLeft,
  file: File,
  files: Files,
  folder: Folder,
  "new-file": FilePlus,
  "new-folder": FolderPlus,
  terminal: SquareTerminal,
  assistant: MessageSquare,
  wallet: Wallet,
  account: CircleUserRound,
  settings: Settings,
  help: CircleHelp,
  history: History,
  time: Clock,
  lock: Lock,
  "sign-out": LogOut,
}

type IconName = keyof typeof ICONS

const SIZES = { 16: "size-4", 20: "size-5", 24: "size-6" } as const

/* Without a size the icon takes the one its container gives svgs (a button,
   a menu item), so it follows that component's own scale. */
function Icon({
  name,
  size,
  className,
  ...props
}: Omit<React.ComponentProps<"svg">, "ref"> & {
  name: IconName
  size?: keyof typeof SIZES
}) {
  const Glyph = ICONS[name]
  return (
    <Glyph
      data-slot="icon"
      data-icon={name}
      strokeWidth={1.5}
      aria-hidden="true"
      className={cn("shrink-0", size && SIZES[size], className)}
      {...props}
    />
  )
}

export { Icon, ICONS }
export type { IconName }
