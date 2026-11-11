import { ArrowRight, Check, FileJson } from "lucide-react";
import type { ReactNode } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import {
  CodeBlock,
  CodeBlockContent,
  CodeBlockLine,
} from "@/shared/ui/code-block";
import { CopyButton } from "@/shared/ui/copy-button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/ui/dialog";
import { DropZone, DropZoneIcon, DropZoneTitle } from "@/shared/ui/drop-zone";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";

import type {
  Command,
  CommandStepId,
  GuideStep,
  IdlBuildMethod,
} from "../model/steps";
import { IDL_PATH, isIdlBuildMethod } from "../model/steps";

/** The "Download project" button's state; `failed` carries what to show under it */
export type Download = { state: "idle" } | { state: "failed"; message: string };

/** What became of the file dropped on the last step */
export type Landing = "waiting" | "loaded" | "refused";

/** Whether the project can follow the guide; a Native or Seahorse export has no Anchor program for `idl-build` to read */
export type Availability = "available" | "coming-soon";

export interface BaseIdlBuildGuideProps {
  availability: Availability;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  method: IdlBuildMethod;
  onMethod: (method: IdlBuildMethod) => void;
  /** The selected method's steps between the download and the upload */
  steps: GuideStep[];
  download: Download;
  onDownload: () => Promise<void>;
  /** A step's command reached the clipboard */
  onCopied: (step: CommandStepId) => void;
  landing: Landing;
  /** The IDL file dropped or picked on the last step */
  onIdlFile: (file: File) => void;
  /** "Go to Interact" once the IDL is loaded; the dialog has closed */
  onInteract: () => void;
}

const TRIGGER = "Build the IDL locally";

/** Both methods stay in view, each with what it needs, so the choice reads before a click */
const METHODS: { value: IdlBuildMethod; label: string; needs: string }[] = [
  { value: "docker", label: "Docker", needs: "Only Docker needed" },
  {
    value: "local",
    label: "Local toolchain",
    needs: "Rust, Solana CLI, Anchor",
  },
];

/** The dialog's gutter, shared by its header, steps and foot */
const GUTTER = "px-5";

/**
 * A step is its number and its control. `block` lines the number up with the
 * first line of a 12px-padded block; a row of controls centres it instead.
 */
const Step = ({
  n,
  block,
  children,
}: {
  n: number;
  block: boolean;
  children: ReactNode;
}) => (
  <li className={cn("flex gap-3", !block && "items-center")}>
    <span
      aria-hidden="true"
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-hover font-mono text-xs text-muted-foreground",
        block && "mt-2.5"
      )}
    >
      {n}
    </span>
    <div className="flex min-w-0 flex-1 flex-col gap-2">{children}</div>
  </li>
);

/**
 * Commands with no header and no line numbers. Long lines wrap with a
 * hanging indent, so what gets copied can be read; Copy stays visible.
 */
const CommandBlock = ({
  p,
  command,
}: {
  p: BaseIdlBuildGuideProps;
  command: Command;
}) => (
  <CodeBlock className="relative">
    <CopyButton
      value={command.lines.join("\n")}
      label="Copy command"
      className="absolute top-2.5 right-2.5"
      onCopied={() => p.onCopied(command.id)}
      onError={reportButtonFailure("copy the command")}
    />
    <CodeBlockContent className="p-3 pr-11">
      {command.lines.map((line) => (
        <CodeBlockLine
          key={line}
          className="pl-[2ch] -indent-[2ch] break-words whitespace-pre-wrap before:hidden"
        >
          {line}
        </CodeBlockLine>
      ))}
    </CodeBlockContent>
  </CodeBlock>
);

/** The toolchain install, open: its commands are what an engineer reads to pick a method */
const Install = ({
  p,
  step,
}: {
  p: BaseIdlBuildGuideProps;
  step: Extract<GuideStep, { kind: "install" }>;
}) => (
  <div className="flex flex-col gap-4">
    {/* pt-3 matches a code block's padding, so the step number lines up */}
    <p className="pt-3">
      {step.title} <span className="text-muted-foreground">if missing</span>
    </p>
    {step.tools.map((tool) => (
      <div key={tool.command.id} className="flex flex-col gap-2">
        <p className="text-xs text-muted-foreground">{tool.name}</p>
        <CommandBlock p={p} command={tool.command} />
      </div>
    ))}
    <p className="text-xs text-muted-foreground">{step.note}</p>
  </div>
);

const DownloadStep = ({ p }: { p: BaseIdlBuildGuideProps }) => (
  <Step n={1} block={false}>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <AsyncButton
        variant="outline"
        size="sm"
        loadingText="Downloading…"
        onClick={p.onDownload}
        onError={reportButtonFailure("download the project")}
      >
        Download project
      </AsyncButton>
      <span className="text-muted-foreground">
        and open a terminal in its folder
      </span>
    </div>
    {p.download.state === "failed" && (
      <p role="alert" className="text-xs text-error">
        {p.download.message}
      </p>
    )}
  </Step>
);

/**
 * The last step, fixed at the dialog's foot: the place to come back to from
 * the terminal. The IDL lands here, and the foot says whether it was one.
 */
const Foot = ({ p, n }: { p: BaseIdlBuildGuideProps; n: number }) => (
  <div
    className={cn(
      "rounded-b-xl border-t border-border bg-muted/50 py-5",
      GUTTER
    )}
  >
    {p.landing === "loaded" ? (
      <div role="status" className="flex items-center gap-3">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
          <Check className="size-3.5" />
        </span>
        <p className="min-w-0 flex-1 font-medium">IDL loaded</p>
        <Button
          onClick={() => {
            p.onOpenChange(false);
            p.onInteract();
          }}
        >
          Go to Interact
          <ArrowRight data-icon="inline-end" />
        </Button>
      </div>
    ) : (
      <ol aria-label="Upload the IDL">
        <Step n={n} block>
          <DropZone
            accept=".json"
            onFiles={(files) => {
              if (files[0]) p.onIdlFile(files[0]);
            }}
            className="flex-row justify-start gap-2 p-3"
          >
            <DropZoneIcon className="mb-0 [&_svg:not([class*='size-'])]:size-4">
              <FileJson />
            </DropZoneIcon>
            <DropZoneTitle>Drop {IDL_PATH} or browse</DropZoneTitle>
          </DropZone>
          {p.landing === "refused" && (
            <p role="alert" className="text-xs text-error">
              That file is not an Anchor IDL.
            </p>
          )}
        </Step>
      </ol>
    )}
  </div>
);

/** A disabled button takes no pointer events, so its wrapper holds the tooltip */
const ComingSoonTrigger = () => (
  <Tooltip>
    <TooltipTrigger asChild>
      <div>
        <Button variant="outline" aria-label={TRIGGER} disabled>
          {TRIGGER}
        </Button>
      </div>
    </TooltipTrigger>
    <TooltipContent>Coming soon</TooltipContent>
  </Tooltip>
);

/**
 * The button that opens the guide, and the guide: a method picker, then the
 * download, the method's steps, and the IDL's upload at the foot. Only the
 * steps scroll, so the picker and the upload stay in view.
 */
const Guide = ({ p }: { p: BaseIdlBuildGuideProps }) => (
  <Dialog open={p.open} onOpenChange={p.onOpenChange}>
    <DialogTrigger asChild>
      <Button variant="outline" aria-label={TRIGGER}>
        {TRIGGER}
      </Button>
    </DialogTrigger>
    <DialogContent className="grid max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-0 p-0 sm:max-w-2xl">
      <div className={cn("flex flex-col gap-5 pt-5 pb-6", GUTTER)}>
        <DialogHeader className="pr-8">
          <DialogTitle>Build the IDL on your machine</DialogTitle>
          <DialogDescription className="sr-only">
            Interact needs the program&apos;s IDL. Build it locally and upload
            it here.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup
          aria-label="IDL build method"
          value={p.method}
          onValueChange={(value) => {
            if (isIdlBuildMethod(value)) p.onMethod(value);
          }}
          className="grid-cols-1 gap-3 sm:grid-cols-2"
        >
          {METHODS.map((m) => (
            <label
              key={m.value}
              className="flex cursor-pointer items-start gap-3 rounded-xl border border-border p-3 hover:bg-surface-hover has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
            >
              <RadioGroupItem
                value={m.value}
                aria-label={m.label}
                className="mt-0.5"
              />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="font-medium">{m.label}</span>
                <span className="text-xs text-muted-foreground">{m.needs}</span>
              </span>
            </label>
          ))}
        </RadioGroup>
      </div>
      <ol
        aria-label="Steps"
        className={cn(
          "flex min-h-0 flex-col gap-5 overflow-y-auto pb-6 [scrollbar-width:none]",
          GUTTER
        )}
      >
        <DownloadStep p={p} />
        {p.steps.map((step, i) => (
          <Step
            key={step.kind === "command" ? step.command.id : step.kind}
            n={i + 2}
            block
          >
            {step.kind === "command" ? (
              <CommandBlock p={p} command={step.command} />
            ) : (
              <Install p={p} step={step} />
            )}
          </Step>
        ))}
      </ol>
      <Foot p={p} n={p.steps.length + 2} />
    </DialogContent>
  </Dialog>
);

const BaseIdlBuildGuide = (p: BaseIdlBuildGuideProps) => {
  if (p.availability === "coming-soon") return <ComingSoonTrigger />;
  return <Guide p={p} />;
};

export default BaseIdlBuildGuide;
