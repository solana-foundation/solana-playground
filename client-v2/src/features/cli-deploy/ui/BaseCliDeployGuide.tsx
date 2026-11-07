import type { ReactNode } from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
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
} from "@/shared/ui/dialog";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";

import type { CliCluster, CliTool, IdlCommandKind } from "../model/commands";
import {
  deployCommands,
  idlCommands,
  PROGRAM_ID_PLACEHOLDER,
} from "../model/commands";
import type { CommandStep } from "../model/telemetry";

export interface BaseCliDeployGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool: CliTool;
  cluster: CliCluster;
  onToolChange: (tool: CliTool) => void;
  onClusterChange: (cluster: CliCluster) => void;
  /** The program's file name without extension */
  name: string;
  /** The project's program id, `undefined` when it has none yet */
  programId: string | undefined;
  /** The last build succeeded, so there is a binary to download */
  built: boolean;
  /** The binary download, shown once `built` */
  download: ReactNode;
  /** Playground holds an IDL for the program, so step 3.1 has one to upload */
  hasIdl: boolean;
  /** The IDL download, beside the binary's; shown with or without a build */
  downloadIdl: ReactNode;
  /** The id of step 3.1's "no IDL" line, which describes the off download */
  noIdlId: string;
  /** A command's copy button was pressed, in step 3 or 3.1 */
  onCopy: (step: CommandStep) => void;
}

const TOOLS: Record<CliTool, string> = {
  solana: "Solana CLI",
  anchor: "Anchor",
};

const CLUSTERS: Record<CliCluster, string> = {
  devnet: "Devnet",
  mainnet: "Mainnet",
};

const PAYER: Record<CliCluster, string> = {
  devnet:
    "It pays from your CLI wallet (solana config get). On Devnet, solana airdrop 2 --url devnet funds it.",
  mainnet: "It pays real SOL from your CLI wallet (solana config get).",
};

/**
 * What to do without the project's program keypair, per tool, said against
 * the commands `deployCommands` shows.
 *
 * TODO(HOO-2397): link the Deploy stage's keypair export from here, and align
 * its file name: it saves `program-keypair.json`, these commands read
 * `<name>-keypair.json`. Until then a user without the file follows this text.
 */
const NO_KEYPAIR: Record<CliTool, (name: string) => string> = {
  solana: () =>
    "Without that file, leave out --program-id: the deploy creates a new program id.",
  anchor: (name) =>
    `Without that file, drop ${name}-keypair.json from the cp: anchor deploy uses the workspace's own keypair and its program id.`,
};

/** Each step 3.1 command block's title and copy button label */
const IDL_COMMANDS: Record<
  IdlCommandKind,
  { title: string; copy: string; failure: string }
> = {
  "program-metadata": {
    title: "Program Metadata",
    copy: "Copy the IDL upload command",
    failure: "copy the IDL upload command",
  },
  anchor: {
    title: "Anchor before 1.0 · legacy IDL account",
    copy: "Copy the Anchor IDL command",
    failure: "copy the Anchor IDL command",
  },
};

/**
 * A command block with its copy button. `onCopy` fires on the copy button's
 * press only, not a click beside it.
 */
const Commands = (p: {
  title: string;
  copyLabel: string;
  /** What did not happen when the copy fails, for its toast */
  failure: string;
  lines: string[];
  onCopy: () => void;
}) => (
  <CodeBlock>
    <CodeBlockHeader>
      <CodeBlockTitle>{p.title}</CodeBlockTitle>
      <CodeBlockActions
        onClickCapture={(e) => {
          const target = e.target as Element;
          if (target.closest('[data-slot="copy-button"]')) p.onCopy();
        }}
      >
        <CopyButton
          value={p.lines.join("\n")}
          label={p.copyLabel}
          onError={reportButtonFailure(p.failure)}
        />
      </CodeBlockActions>
    </CodeBlockHeader>
    <CodeBlockContent>
      {p.lines.map((line) => (
        // A command wraps rather than scrolls: the dialog is narrow on a
        // phone, and a hidden tail is a wrong command copied by eye
        <CodeBlockLine
          key={line}
          className="whitespace-pre-wrap [overflow-wrap:anywhere]"
        >
          {line}
        </CodeBlockLine>
      ))}
    </CodeBlockContent>
  </CodeBlock>
);

/** A numbered step of the guide */
const Step = ({ title, children }: { title: string; children: ReactNode }) => (
  <li className="flex flex-col gap-2">
    <h3 className="text-caption font-act text-foreground">{title}</h3>
    {children}
  </li>
);

/** The CLI deploy guide, drawn from props alone; `CliDeployGuide` connects it */
const BaseCliDeployGuide = (p: BaseCliDeployGuideProps) => {
  const commands = deployCommands({
    tool: p.tool,
    cluster: p.cluster,
    name: p.name,
  });
  const uploads = idlCommands({
    tool: p.tool,
    cluster: p.cluster,
    name: p.name,
    programId: p.programId,
  });
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      {/* Anchor's commands make the guide taller than a short window: the
          dialog stops at the window's edge and only the steps scroll, so
          the title and the toggles stay in view (HOO-2701) */}
      <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Deploy from your machine</DialogTitle>
          <DialogDescription>
            Deploy the program Playground built with your own tools. Your
            wallet&apos;s key stays on your machine.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-2">
          <Segmented
            aria-label="Tool"
            value={p.tool}
            onValueChange={(v) => p.onToolChange(v as CliTool)}
          >
            {(Object.keys(TOOLS) as CliTool[]).map((t) => (
              <SegmentedItem key={t} value={t}>
                {TOOLS[t]}
              </SegmentedItem>
            ))}
          </Segmented>
          <Segmented
            aria-label="Cluster"
            value={p.cluster}
            onValueChange={(v) => p.onClusterChange(v as CliCluster)}
          >
            {(Object.keys(CLUSTERS) as CliCluster[]).map((c) => (
              <SegmentedItem key={c} value={c}>
                {CLUSTERS[c]}
              </SegmentedItem>
            ))}
          </Segmented>
        </div>
        {/* `-m-1 p-1` keeps the copy buttons' focus rings clear of the
            scroll clip on every side */}
        <ol className="-m-1 flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-1">
          <Step title="1. Download the program">
            {/* The IDL can be loaded without a build, so its download does
                not wait for one; step 3.1 names the file it saves */}
            <div className="flex flex-wrap items-center gap-2">
              {p.built && p.download}
              {p.downloadIdl}
            </div>
            {!p.built && (
              <p className="text-caption text-muted-foreground">
                Build successfully first to download the program.
              </p>
            )}
          </Step>
          <Step title="2. Use the program keypair">
            <p className="text-caption text-muted-foreground">
              Deploying with this project&apos;s program keypair,{" "}
              <code className="font-mono">{p.name}-keypair.json</code>, keeps
              the program id
              {p.programId && (
                <>
                  {" "}
                  <code className="font-mono break-all">{p.programId}</code>
                </>
              )}
              . {NO_KEYPAIR[p.tool](p.name)}
            </p>
          </Step>
          <Step title="3. Run the deploy">
            <Commands
              title={`${TOOLS[p.tool]} · ${CLUSTERS[p.cluster]}`}
              copyLabel="Copy the deploy command"
              failure="copy the deploy command"
              lines={commands}
              onCopy={() => p.onCopy("deploy")}
            />
            {p.tool === "anchor" && (
              <p className="text-caption text-muted-foreground">
                Run it in an Anchor workspace whose program is named{" "}
                <code className="font-mono">{p.name}</code>.
              </p>
            )}
            <p className="text-caption text-muted-foreground">
              {PAYER[p.cluster]}
            </p>
          </Step>
          <Step title="3.1 Upload the IDL">
            {p.hasIdl ? (
              <>
                {uploads.map((c) => (
                  <Commands
                    key={c.kind}
                    title={IDL_COMMANDS[c.kind].title}
                    copyLabel={IDL_COMMANDS[c.kind].copy}
                    failure={IDL_COMMANDS[c.kind].failure}
                    lines={c.lines}
                    onCopy={() => p.onCopy("idl")}
                  />
                ))}
                <p className="text-caption text-muted-foreground">
                  Run it beside <code className="font-mono">{p.name}.json</code>{" "}
                  once the deploy finished, with the wallet that deployed:
                  Explorer then names the program&apos;s instructions.
                  {p.tool === "anchor" && (
                    <>
                      {" "}
                      <code className="font-mono">anchor idl init</code> signs
                      with the wallet in Anchor.toml; on Anchor 1.0 and later it
                      writes the same Program Metadata account, so the first
                      command is enough.
                    </>
                  )}
                  {p.programId ? (
                    <>
                      {" "}
                      After a deploy without the project&apos;s keypair, use the
                      program id it printed instead of this one.
                    </>
                  ) : (
                    <>
                      {" "}
                      Put the program id the deploy printed in place of{" "}
                      <code className="font-mono">
                        {PROGRAM_ID_PLACEHOLDER}
                      </code>
                      .
                    </>
                  )}
                </p>
              </>
            ) : (
              <p id={p.noIdlId} className="text-caption text-muted-foreground">
                This program has no IDL to upload.
              </p>
            )}
          </Step>
        </ol>
      </DialogContent>
    </Dialog>
  );
};

export default BaseCliDeployGuide;
