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
import { deployCommands } from "../model/commands";
import type { CliCluster, CliTool } from "../model/commands";

export interface BaseCliDeployGuideProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tool: CliTool;
  cluster: CliCluster;
  onToolChange: (tool: CliTool) => void;
  onClusterChange: (cluster: CliCluster) => void;
  /** The program's file name without extension */
  name: string;
  /** The project's program id, `null` when it has none yet */
  programId: string | null;
  /** The last build succeeded, so there is a binary to download */
  built: boolean;
  /** The binary download, shown once `built` */
  download: ReactNode;
  /** A command's copy button was pressed */
  onCopy: () => void;
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
    "It pays from your CLI wallet (solana config get). On devnet, solana airdrop 2 --url devnet funds it.",
  mainnet: "It pays real SOL from your CLI wallet (solana config get).",
};

/**
 * What to do without the project's program keypair, per tool, said against
 * the commands `deployCommands` shows.
 *
 * TODO(HOO-2397): link the keypair's export from the Deploy stage once it
 * exists; until then a user without the file follows this text.
 */
const NO_KEYPAIR: Record<CliTool, (name: string) => string> = {
  solana: () =>
    "Without that file, leave out --program-id: the deploy creates a new program id.",
  anchor: (name) =>
    `Without that file, drop ${name}-keypair.json from the cp: anchor deploy uses the workspace's own keypair and its program id.`,
};

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
  const script = commands.join("\n");
  return (
    <Dialog open={p.open} onOpenChange={p.onOpenChange}>
      <DialogContent className="sm:max-w-lg">
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
        <ol className="flex min-w-0 flex-col gap-4">
          <Step title="1. Download the program">
            {p.built ? (
              <div className="flex flex-wrap items-center gap-2">
                {p.download}
              </div>
            ) : (
              <p className="text-caption text-muted-foreground">
                Build successfully first.
              </p>
            )}
          </Step>
          <Step title="2. Use the program keypair">
            <p className="text-caption text-muted-foreground">
              Deploying with this project&apos;s program keypair,{" "}
              <code className="font-mono">{p.name}-keypair.json</code>, keeps
              the program id
              {p.programId ? (
                <>
                  {" "}
                  <code className="font-mono break-all">{p.programId}</code>
                </>
              ) : null}
              . {NO_KEYPAIR[p.tool](p.name)}
            </p>
          </Step>
          <Step title="3. Run the deploy">
            <CodeBlock>
              <CodeBlockHeader>
                <CodeBlockTitle>
                  {TOOLS[p.tool]} · {CLUSTERS[p.cluster]}
                </CodeBlockTitle>
                <CodeBlockActions
                  onClickCapture={(e) => {
                    // Only the copy button's press, not a click beside it
                    const target = e.target as Element;
                    if (target.closest('[data-slot="copy-button"]')) p.onCopy();
                  }}
                >
                  <CopyButton
                    value={script}
                    label="Copy the deploy command"
                    onError={reportButtonFailure("copy the deploy command")}
                  />
                </CodeBlockActions>
              </CodeBlockHeader>
              <CodeBlockContent>
                {commands.map((line) => (
                  // A command wraps rather than scrolls: the dialog is narrow
                  // on a phone, and a hidden tail is a wrong command copied
                  // by eye
                  <CodeBlockLine
                    key={line}
                    className="whitespace-pre-wrap [overflow-wrap:anywhere]"
                  >
                    {line}
                  </CodeBlockLine>
                ))}
              </CodeBlockContent>
            </CodeBlock>
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
        </ol>
      </DialogContent>
    </Dialog>
  );
};

export default BaseCliDeployGuide;
