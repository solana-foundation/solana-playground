import type { ReactNode } from "react";
import { ExternalLink, Rocket } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { BrandButton, BrandButtonIcon } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { CopyButton } from "@/shared/ui/copy-button";
import {
  StageEmpty,
  StageEmptyActions,
  StageEmptyDescription,
  StageEmptyMedia,
  StageEmptyMeta,
  StageEmptyTitle,
} from "@/shared/ui/stage-empty";
import { StatusDot } from "@/shared/ui/status-dot";
import type { DeployRecord } from "../state/deploy-history";
import {
  STAGE_BODY,
  STAGE_FOOT,
  STAGE_FRAME,
  STAGE_REPORT,
} from "./stage-layout";

/**
 * What the chain says about the deployed program; `null` when unknown or,
 * for the authority and size, when the program can no longer be upgraded
 */
export interface DeployDetails {
  upgradable: boolean | null;
  authority: string | null;
  programSize: number | null;
}

/** Where the project's last deploy stands */
export type DeployStatus = "idle" | "running" | "failed";

export interface BaseDeployProps {
  /** The cluster's name, `null` until the endpoint has been read */
  cluster: string | null;
  /** The last build succeeded, so there is something to deploy */
  built: boolean;
  /**
   * The last deploy's state. While one runs, a second press would pause it,
   * so the button is held.
   */
  deploy: DeployStatus;
  /** The project's own program id, shown before the first deployment */
  programId: string | null;
  details: DeployDetails;
  /** Every deployment of the project, newest first */
  history: DeployRecord[];
  addressUrl: (programId: string) => string;
  txUrl: (signature: string) => string;
  onDeploy: () => void;
  onInteract: () => void;
  /** The secondary "Upload IDL" action (`IdlActions mode="upload"`) */
  idlUpload: ReactNode;
}

/** Why the Deploy button is off, for its tooltip; undefined when it is on */
const deployBlockedReason = (p: BaseDeployProps) => {
  if (!p.built) return "Build successfully first";
  if (p.deploy === "running") return "A deploy is already running";
  return undefined;
};

const deployLabel = (p: BaseDeployProps, redeploy: boolean) => {
  if (p.deploy === "running") return redeploy ? "Upgrading..." : "Deploying...";
  const where = clusterName(p);
  return redeploy ? `Redeploy to ${where}` : `Deploy to ${where}`;
};

/** The cluster for prose; "the network" until the endpoint has been read */
const clusterName = (p: BaseDeployProps) => p.cluster ?? "the network";

const description = (p: BaseDeployProps, latest: DeployRecord | null) => {
  if (!p.built) {
    return "Build the program first \u2014 the stepper unlocks Deploy once it compiles cleanly.";
  }
  if (latest) {
    return "The program id stays constant across deploys; redeploying upgrades it in place.";
  }
  return `Deploying sends the compiled program to ${clusterName(
    p
  )} using the connected wallet.`;
};

const ExplorerLink = ({ href, label }: { href: string; label: string }) => (
  <Button size="sm" variant="ghost" asChild>
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
      Explorer
      <ExternalLink data-icon="inline-end" />
    </a>
  </Button>
);

/** A labelled fact in the result block */
const Fact = ({ name, children }: { name: string; children: ReactNode }) => (
  <>
    <dt className="text-subtle">{name}</dt>
    <dd className="min-w-0 font-mono break-all text-foreground">{children}</dd>
  </>
);

/** After a deploy: the program id to copy, where to see it, the facts */
const DeployResult = ({
  latest,
  p,
}: {
  latest: DeployRecord;
  p: BaseDeployProps;
}) => {
  const { upgradable, authority, programSize } = p.details;
  return (
    <div
      role="status"
      className="flex w-full flex-col gap-3 rounded-xl border border-border bg-surface-panel p-4"
    >
      <div className="flex items-center gap-2 text-control font-act text-foreground">
        <StatusDot variant="success" size="lg" />
        Deployed to {latest.cluster}
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-surface-base px-3 py-2">
        <span className="shrink-0 text-caption text-subtle">Program id</span>
        <code
          className="min-w-0 truncate font-mono text-code text-foreground"
          title={latest.programId}
        >
          {latest.programId}
        </code>
        <CopyButton
          value={latest.programId}
          label="Copy the program id"
          className="ml-auto"
          onError={reportButtonFailure("copy the program id")}
        />
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-caption">
        {latest.signature && (
          <Fact name="Transaction">
            {latest.signature.slice(0, 20)}&hellip;
          </Fact>
        )}
        {upgradable !== null && (
          <Fact name="Upgradable">{upgradable ? "Yes" : "No"}</Fact>
        )}
        {authority && <Fact name="Authority">{authority}</Fact>}
        {programSize !== null && (
          <Fact name="Program size">
            {programSize.toLocaleString("en-US")} bytes
          </Fact>
        )}
        <Fact name="When">{new Date(latest.at).toLocaleString()}</Fact>
      </dl>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" onClick={p.onInteract}>
          Interact
        </Button>
        <ExplorerLink
          href={p.addressUrl(latest.programId)}
          label={`View latest deployment (${latest.programId}) on Explorer`}
        />
        {latest.signature && (
          <Button size="sm" variant="ghost" asChild>
            <a
              href={p.txUrl(latest.signature)}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={`View latest deployment transaction (${latest.signature}) on Explorer`}
            >
              Transaction
              <ExternalLink data-icon="inline-end" />
            </a>
          </Button>
        )}
      </div>
    </div>
  );
};

/** Every deployment, newest first; drawn once there is one */
const History = ({ p }: { p: BaseDeployProps }) => (
  <section aria-label="History" className="flex w-full flex-col gap-2">
    <h3 className="text-caption font-act text-muted-foreground">History</h3>
    <ul className="flex flex-col divide-y divide-border">
      {p.history.map((r) => (
        <li
          key={r.id}
          className="grid grid-cols-[5.5rem_1fr_auto] items-center gap-3 py-1.5 text-caption max-md:grid-cols-[5.5rem_1fr]"
        >
          <Badge variant="outline" className="font-mono lowercase">
            {r.cluster}
          </Badge>
          <span className="min-w-0 truncate font-mono" title={r.programId}>
            {r.programId.slice(0, 8)}&hellip;{r.programId.slice(-4)}
            <span className="ml-3 text-subtle">
              {new Date(r.at).toLocaleString()}
            </span>
          </span>
          <ExplorerLink
            href={p.addressUrl(r.programId)}
            label={`View deployment (${r.programId}) on Explorer`}
          />
        </li>
      ))}
    </ul>
  </section>
);

/**
 * The Deploy stage, drawn from props alone; `Deploy` connects it. Before the
 * first deploy it is the prototype's empty stage: centred, the pill and
 * "Upload IDL" under it, no history yet. After one it shows the result and
 * the history, read from the left.
 */
const BaseDeploy = (p: BaseDeployProps) => {
  const latest = p.history[0] ?? null;
  const n = p.history.length;
  const meta = [p.cluster, latest && `${n} deployment${n === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" · ");
  const running = p.deploy === "running";

  return (
    <div className={STAGE_FRAME}>
      <StageEmpty className={cn(STAGE_BODY, latest && STAGE_REPORT)}>
        {latest && (
          <StageEmptyMedia>
            <Rocket />
          </StageEmptyMedia>
        )}
        <StageEmptyTitle>
          {latest ? "Deploy" : "Nothing deployed yet"}
        </StageEmptyTitle>
        {meta && <StageEmptyMeta>{meta}</StageEmptyMeta>}
        <StageEmptyDescription>{description(p, latest)}</StageEmptyDescription>
        {p.built && !latest && p.programId && (
          <p className="text-caption text-muted-foreground">
            Program id <code className="font-mono">{p.programId}</code>
          </p>
        )}
        {p.deploy === "failed" && (
          <Callout variant="error" role="alert">
            <CalloutDescription>
              Deploy failed - see the console.
            </CalloutDescription>
          </Callout>
        )}
        {latest && <DeployResult latest={latest} p={p} />}
        {latest && <History p={p} />}
        <StageEmptyActions className={cn(STAGE_FOOT, !latest && "flex-col")}>
          <BrandButton
            disabled={!p.built || running}
            aria-busy={running || undefined}
            title={deployBlockedReason(p)}
            onClick={p.onDeploy}
          >
            {deployLabel(p, latest !== null)}
            {!running && <BrandButtonIcon />}
          </BrandButton>
          {/* Before the first deploy, centred under the pill on a desk and
              above it on a phone, where the row stretches the pill to the
              screen's width; after one, beside the pill */}
          <div className="flex justify-center">{p.idlUpload}</div>
        </StageEmptyActions>
      </StageEmpty>
    </div>
  );
};

export default BaseDeploy;
