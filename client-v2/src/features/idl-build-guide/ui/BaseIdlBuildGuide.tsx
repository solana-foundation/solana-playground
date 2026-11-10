import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import {
  CodeBlock,
  CodeBlockActions,
  CodeBlockContent,
  CodeBlockHeader,
  CodeBlockLine,
  CodeBlockTitle,
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
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";

import type { CommandStepId, GuideStep, IdlBuildMethod } from "../model/steps";
import { isIdlBuildMethod } from "../model/steps";

/** The "Download project" button's state; `failed` carries what to show under it */
export type Download = { state: "idle" } | { state: "failed"; message: string };

export interface BaseIdlBuildGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  method: IdlBuildMethod;
  onMethod: (method: IdlBuildMethod) => void;
  /** The selected method's steps, from the download to the upload */
  steps: GuideStep[];
  download: Download;
  onDownload: () => Promise<void>;
  /** A step's command reached the clipboard */
  onCopied: (step: CommandStepId) => void;
  /** The last step's Upload IDL link; the dialog has closed */
  onUpload: () => void;
}

const TRIGGER = "Build the IDL locally";

const METHODS: { value: IdlBuildMethod; label: string }[] = [
  { value: "docker", label: "Docker" },
  { value: "local", label: "Local toolchain" },
];

const DownloadStep = ({
  p,
  title,
}: {
  p: BaseIdlBuildGuideProps;
  title: string;
}) => (
  <div className="flex flex-col items-start gap-2">
    <p>{title}</p>
    <AsyncButton
      variant="outline"
      size="sm"
      loadingText="Downloading…"
      onClick={p.onDownload}
      onError={reportButtonFailure("download the project")}
    >
      Download project
    </AsyncButton>
    {p.download.state === "failed" && (
      <p role="alert" className="text-xs text-error">
        {p.download.message}
      </p>
    )}
  </div>
);

const StepTitle = ({
  step,
}: {
  step: Extract<GuideStep, { kind: "command" }>;
}) => {
  const at = step.link ? step.title.indexOf(step.link.text) : -1;
  if (!step.link || at === -1) return <p>{step.title}</p>;
  return (
    <p>
      {step.title.slice(0, at)}
      <a
        href={step.link.href}
        target="_blank"
        rel="noopener noreferrer"
        className="underline underline-offset-4"
      >
        {step.link.text}
      </a>
      {step.title.slice(at + step.link.text.length)}
    </p>
  );
};

const CommandStep = ({
  p,
  step,
}: {
  p: BaseIdlBuildGuideProps;
  step: Extract<GuideStep, { kind: "command" }>;
}) => (
  <div className="flex min-w-0 flex-col gap-2">
    <StepTitle step={step} />
    {step.note && <p className="text-xs text-muted-foreground">{step.note}</p>}
    <CodeBlock>
      <CodeBlockHeader>
        <CodeBlockTitle>shell</CodeBlockTitle>
        <CodeBlockActions>
          <CopyButton
            value={step.lines.join("\n")}
            label="Copy command"
            onCopied={() => p.onCopied(step.id)}
            onError={reportButtonFailure("copy the command")}
          />
        </CodeBlockActions>
      </CodeBlockHeader>
      <CodeBlockContent>
        {step.lines.map((line) => (
          <CodeBlockLine key={line}>{line}</CodeBlockLine>
        ))}
      </CodeBlockContent>
    </CodeBlock>
  </div>
);

const UploadStep = ({
  p,
  step,
}: {
  p: BaseIdlBuildGuideProps;
  step: Extract<GuideStep, { kind: "upload" }>;
}) => (
  <div className="flex flex-col items-start gap-2">
    <p>
      {step.title}{" "}
      <Button
        variant="link"
        className="h-auto p-0"
        onClick={() => {
          p.onOpenChange(false);
          p.onUpload();
        }}
      >
        Upload IDL
      </Button>
    </p>
    <p className="text-xs text-muted-foreground">{step.note}</p>
  </div>
);

const Step = ({ p, step }: { p: BaseIdlBuildGuideProps; step: GuideStep }) => {
  if (step.kind === "download")
    return <DownloadStep p={p} title={step.title} />;
  if (step.kind === "command") return <CommandStep p={p} step={step} />;
  return <UploadStep p={p} step={step} />;
};

/**
 * The button that opens the guide, and the guide: a method picker and the
 * method's numbered steps, from downloading the project to uploading the IDL.
 */
const BaseIdlBuildGuide = (p: BaseIdlBuildGuideProps) => (
  <Dialog open={p.open} onOpenChange={p.onOpenChange}>
    <DialogTrigger asChild>
      <Button variant="outline" aria-label={TRIGGER}>
        {TRIGGER}
      </Button>
    </DialogTrigger>
    <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-xl">
      <DialogHeader>
        <DialogTitle>Build the IDL on your machine</DialogTitle>
        <DialogDescription>
          The Playground builds the program but not its IDL. Build the IDL
          locally, then upload it to call the program from Interact.
        </DialogDescription>
      </DialogHeader>
      <Segmented
        aria-label="IDL build method"
        value={p.method}
        onValueChange={(value) => {
          if (isIdlBuildMethod(value)) p.onMethod(value);
        }}
      >
        {METHODS.map((m) => (
          <SegmentedItem key={m.value} value={m.value}>
            {m.label}
          </SegmentedItem>
        ))}
      </Segmented>
      <ol className="flex min-w-0 list-decimal flex-col gap-4 pl-5">
        {p.steps.map((step) => (
          <li key={step.kind === "command" ? step.id : step.kind}>
            <Step p={p} step={step} />
          </li>
        ))}
      </ol>
    </DialogContent>
  </Dialog>
);

export default BaseIdlBuildGuide;
