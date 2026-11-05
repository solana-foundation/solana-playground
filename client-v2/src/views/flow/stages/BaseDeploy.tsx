import { ExternalLink, Rocket, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";

import type { DeployFundingError, DeployRunState } from "@/commands/deploy/run";
import { UNKNOWN_NETWORK } from "@/constants";
import type { GuideFrom } from "@/features/cli-deploy";
import {
  BaseBackupLine,
  BaseDeployProgress,
  BaseNotEnoughSol,
  BaseStaleBuildDialog,
  formatSol,
  networkInSentence,
  networkName,
  shortKey,
} from "@/features/deploy";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { Badge } from "@/shared/ui/badge";
import { BrandButton, BrandButtonIcon } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription, CalloutTitle } from "@/shared/ui/callout";
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

import {
  MAINNET_DEPLOY_WARNING_BODY,
  MAINNET_DEPLOY_WARNING_GUIDE,
  MAINNET_DEPLOY_WARNING_TITLE,
  warnsOnDeploy,
} from "../../../commands/deploy/mainnet-warning";
import type { DeployRecord } from "../state/deploy-history";
import {
  STAGE_BODY,
  STAGE_FOOT,
  STAGE_FRAME,
  STAGE_REPORT,
} from "./stage-layout";

/**
 * What the chain says about the deployed program; absent when unknown or,
 * for the authority and size, when the program can no longer be upgraded
 */
export interface DeployDetails {
  upgradable: boolean | undefined;
  authority: string | undefined;
  programSize: number | undefined;
}

/** Where the project's last deploy stands */
export type DeployStatus = "idle" | "running" | "failed";

/** The wallet that pays for the deploy; `balance` is SOL, absent until read */
export interface DeployPayer {
  address: string;
  balance: number | undefined;
  /** The Playground wallet, not a connected one such as Phantom */
  playground: boolean;
}

/** Why the last run could not fund its wallet */
export type FundingStop = DeployFundingError["detail"];

export interface BaseDeployProps {
  /** The cluster's name, `null` until the endpoint has been read */
  cluster: string | null;
  /**
   * There is a binary to deploy: the last build succeeded, or it failed and
   * an earlier one exists (the stage asks before deploying that one)
   */
  built: boolean;
  /**
   * The last deploy's state. While one runs, a second press would pause it,
   * so the button is held.
   */
  deploy: DeployStatus;
  details: DeployDetails;
  /** Every deployment of the project on any network, newest first; the stage reads the network picked from it */
  history: DeployRecord[];
  /** The wallet that pays, Playground or connected; absent while none is current */
  payer: DeployPayer | undefined;
  /** The running deploy's steps */
  run: DeployRunState;
  /** The last run stopped for lack of SOL */
  funding: FundingStop | undefined;
  /** Show the keypair backup line under the result */
  backup: boolean;
  /** Ask whether to deploy the last good build */
  staleBuild: boolean;
  /**
   * An Explorer link that opens `cluster`, whatever network is selected;
   * `undefined` when the explorer cannot open it, and the link is left out
   */
  addressUrl: (programId: string, cluster: string) => string | undefined;
  txUrl: (signature: string, cluster: string) => string | undefined;
  onDeploy: () => void;
  onSignIn: () => void;
  onSaveKeypair: () => void;
  onDismissBackup: () => void;
  onStaleBuildAnswer: (deploy: boolean) => void;
  onInteract: () => void;
  /** Opens the Build stage, offered while the program is not built */
  onGoToBuild: () => void;
  /** Opens the console, where the terminal has a failed deploy's whole log */
  onShowLog: () => void;
  /** Opens Settings on the network choice, from the summary's Network row */
  onChangeNetwork: () => void;
  /** Settings offers this cluster, so the stage can switch to it */
  isNetworkOffered: (cluster: string) => boolean;
  /** Switches the connection to an offered cluster */
  onShowNetwork: (cluster: string) => void;
  /** The IDL in use, by its program's name; undefined while there is none */
  idlName: string | undefined;
  /** The secondary "Upload IDL" action (`IdlActions mode="upload-button"`) */
  idlUpload: ReactNode;
  /**
   * The folded "Program id" block (`ProgramKeypair`): the last row of the
   * facts card before the first deploy on the network picked; after one, the
   * last row of a card under the history, below the IDL
   */
  programKeypair: ReactNode;
  /** Opens the CLI deploy guide; `from` is the control pressed */
  onOpenCliGuide: (from: GuideFrom) => void;
}

/** Why the Deploy button is off, for its tooltip; undefined when it is on */
const deployBlockedReason = (p: BaseDeployProps) =>
  p.deploy === "running" ? "A deploy is already running" : undefined;

/**
 * A failed deploy of a built program: the stage maps no failure to a named
 * state (Spec 08 ANY-00), so the pill runs the deploy again and says so. With
 * no build the pill is Go to Build instead (Spec 03 DEP-07).
 */
const offersRetry = (p: BaseDeployProps) =>
  p.built && p.deploy === "failed" && !p.funding;

const deployLabel = (p: BaseDeployProps, redeploy: boolean) => {
  if (p.deploy === "running") return redeploy ? "Upgrading..." : "Deploying...";
  if (offersRetry(p)) return "Try again";
  const where = deployNetwork(p);
  return redeploy ? `Redeploy to ${where}` : `Deploy to ${where}`;
};

/**
 * The cluster in the deploy button's label and the stage's prose, lowercase
 * mid-sentence: "mainnet" for mainnet-beta; "the network" until the endpoint
 * has been read
 */
const deployNetwork = (p: BaseDeployProps) =>
  networkInSentence(p.cluster) ?? UNKNOWN_NETWORK;

/**
 * Who pays, before a deploy. With no wallet current, the deploy makes the
 * Playground wallet. Free SOL is promised on devnet only, the network Spec 03's
 * line names; testnet, localnet and playnet airdrop too, but the line stays
 * silent there, and so it does while the cluster is unknown.
 */
const payerLine = (p: BaseDeployProps) => {
  const payer = p.payer;
  if (!payer) {
    return p.cluster === "devnet"
      ? "From your Playground wallet · free devnet SOL"
      : "From your Playground wallet";
  }
  const balance =
    payer.balance === undefined ? "" : ` · ${payer.balance.toFixed(2)} SOL`;
  const which = payer.playground ? "your Playground wallet" : "your wallet";
  return `From ${which} · ${shortKey(payer.address)}${balance}`;
};

/**
 * The stage's prose. `latest` is the latest deployment on the network picked
 * now; a project deployed only on other networks gets `ElsewhereLine` instead.
 */
const description = (p: BaseDeployProps, latest: DeployRecord | undefined) => {
  if (!p.built) return "Build the program first.";
  if (latest) {
    return "The program id stays constant across deploys; redeploying upgrades it in place.";
  }
  return `Deploying sends the compiled program to ${deployNetwork(p)}.`;
};

/**
 * The newest deployment on another network, while the network picked has
 * none (Spec 08's EMPTY-14). Said only once the network is known: until then
 * there is no "here" to set against the others.
 */
const deployedElsewhere = (
  p: BaseDeployProps,
  latest: DeployRecord | undefined
) =>
  latest === undefined && p.cluster
    ? p.history.find((r) => r.cluster !== p.cluster)
    : undefined;

/** The stage's title: "Nothing on mainnet" while only other networks have deployments */
const title = (p: BaseDeployProps, latest: DeployRecord | undefined) => {
  if (latest) return "Deploy";
  if (p.built && deployedElsewhere(p, latest)) {
    return `Nothing on ${networkInSentence(p.cluster) ?? UNKNOWN_NETWORK}`;
  }
  return "Nothing deployed yet";
};

/**
 * EMPTY-14's line, with Show {network} in it as a link when Settings offers
 * that network: the pill keeps the stage's one way on, and the link sits with
 * the sentence it answers. Off while a deploy runs: the deploy's record takes
 * the network read when it ends, so a switch here would file it under this one.
 */
const ElsewhereLine = ({
  p,
  elsewhere,
}: {
  p: BaseDeployProps;
  elsewhere: DeployRecord;
}) => {
  const where = networkInSentence(elsewhere.cluster) ?? UNKNOWN_NETWORK;
  return (
    <StageEmptyDescription>
      {`This project has deploys on ${where}. `}
      {p.isNetworkOffered(elsewhere.cluster) && (
        <Button
          variant="link"
          className="inline h-auto p-0 align-baseline text-[length:inherit] text-foreground"
          disabled={p.deploy === "running"}
          onClick={() => p.onShowNetwork(elsewhere.cluster)}
        >
          {`Show ${where}`}
        </Button>
      )}
    </StageEmptyDescription>
  );
};

/** An Explorer link whose text names the network it opens */
const ExplorerLink = ({
  href,
  label,
  children,
  className,
}: {
  href: string;
  label: string;
  children: ReactNode;
  className?: string;
}) => (
  // The icon at cap height with a little air, not 14px squeezed against the text
  <Button
    size="sm"
    variant="ghost"
    className={cn("gap-1.5", className)}
    asChild
  >
    <a href={href} target="_blank" rel="noopener noreferrer" aria-label={label}>
      {/* One flex item, so the gap sits only before the icon */}
      <span>{children}</span>
      <ExternalLink data-icon="inline-end" className="size-3" />
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

/** After a deploy: what happened, the program id to copy, where to see it */
const DeployResult = ({
  latest,
  p,
}: {
  latest: DeployRecord;
  p: BaseDeployProps;
}) => {
  const { upgradable, authority, programSize } = p.details;
  const network = networkName(latest.cluster);
  const programUrl = p.addressUrl(latest.programId, latest.cluster);
  const txUrl = latest.signature && p.txUrl(latest.signature, latest.cluster);
  return (
    <div
      role="status"
      aria-label="Deploy result"
      className="flex w-full flex-col gap-3 rounded-xl border border-border bg-surface-panel p-4"
    >
      <div className="flex items-center gap-2 text-control font-act text-foreground">
        <StatusDot variant="success" size="lg" />
        {latest.upgraded
          ? "Upgraded. The program id stays the same."
          : `Deployed to ${
              networkInSentence(latest.cluster) ?? UNKNOWN_NETWORK
            }`}
      </div>
      <div className="flex items-center gap-2 rounded-lg bg-surface-base px-3 py-2">
        <span className="shrink-0 text-caption text-subtle">Program id</span>
        <code
          className="min-w-0 truncate font-mono text-code text-foreground"
          title={latest.programId}
        >
          {shortKey(latest.programId)}
        </code>
        <CopyButton
          value={latest.programId}
          label="Copy the program id"
          className="ml-auto"
          onError={reportButtonFailure("copy the program id")}
        />
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1.5 text-caption">
        {latest.cost !== undefined && (
          <Fact name="Cost">{formatSol(latest.cost)} SOL</Fact>
        )}
        {upgradable !== undefined && (
          <Fact name="Upgradable">{upgradable ? "Yes" : "No"}</Fact>
        )}
        {authority && <Fact name="Authority">{authority}</Fact>}
        {programSize !== undefined && (
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
        {programUrl && (
          <ExplorerLink
            href={programUrl}
            label={`View latest deployment (${latest.programId}) on Explorer (${network})`}
          >
            View on Explorer ({network})
          </ExplorerLink>
        )}
        {txUrl && (
          <ExplorerLink
            href={txUrl}
            label={`View latest deployment transaction (${latest.signature}) on Explorer (${network})`}
          >
            Transaction ({network})
          </ExplorerLink>
        )}
      </div>
      {p.backup && (
        <BaseBackupLine
          cluster={latest.cluster}
          onSave={p.onSaveKeypair}
          onDismiss={p.onDismissBackup}
        />
      )}
    </div>
  );
};

/** A history row's Explorer link, left out when the explorer cannot open its network */
const HistoryLink = ({ p, r }: { p: BaseDeployProps; r: DeployRecord }) => {
  const href = p.addressUrl(r.programId, r.cluster);
  // eslint-disable-next-line unicorn/no-null -- a React component renders nothing with null
  if (!href) return null;
  const network = networkName(r.cluster);
  return (
    <ExplorerLink
      href={href}
      className="-mr-2"
      label={`View deployment (${r.programId}) on Explorer (${network})`}
    >
      Explorer<span className="max-md:hidden"> ({network})</span>
    </ExplorerLink>
  );
};

/**
 * Every deployment on any network, newest first, each row under its own
 * network; drawn whenever one exists, even while the network picked has none,
 * so a deployment elsewhere is never hidden
 */
const History = ({ p }: { p: BaseDeployProps }) => (
  // A card of rows like the summary's, read from the left: the network, the
  // program and when, its Explorer link at the end
  <section
    aria-label="History"
    className="flex w-full max-w-[28rem] shrink-0 flex-col gap-2 text-left"
  >
    <h3 className="m-0 px-1 text-caption font-act text-muted-foreground">
      History
    </h3>
    <ul className="m-0 flex list-none flex-col divide-y divide-border overflow-hidden rounded-xl border border-border bg-surface-panel p-0">
      {p.history.map((r) => (
        <li
          key={r.id}
          className="flex min-h-10 items-center gap-3 px-4 py-3 text-caption"
        >
          <Badge variant="outline" className="shrink-0 font-mono">
            {networkName(r.cluster)}
          </Badge>
          {/* The id over its time, so neither is cut to a stray mark in a
              narrow stage; the Explorer link keeps the row's end */}
          <span className="flex min-w-0 flex-1 flex-col gap-1 leading-none">
            <span className="truncate font-mono" title={r.programId}>
              {r.programId.slice(0, 8)}&hellip;{r.programId.slice(-4)}
            </span>
            <span className="truncate text-subtle">
              {new Date(r.at).toLocaleString(undefined, {
                dateStyle: "short",
                timeStyle: "short",
              })}
            </span>
          </span>
          <HistoryLink p={p} r={r} />
        </li>
      ))}
    </ul>
  </section>
);

/** A row of the summary: what, then its value at the right */
const SummaryRow = ({
  name,
  label,
  children,
}: {
  name: string;
  label?: string;
  children: ReactNode;
}) => (
  <div
    aria-label={label}
    className="flex min-h-10 items-center justify-between gap-4 px-4 py-2"
  >
    <dt className="shrink-0 text-caption text-muted-foreground">{name}</dt>
    <dd className="flex min-w-0 items-center gap-1.5 text-caption leading-none text-foreground">
      {children}
    </dd>
  </div>
);

/** The IDL in use, by its program's name, as a row of a facts card */
const IdlRow = ({ name }: { name: string }) => (
  <SummaryRow name="IDL">
    <code className="min-w-0 truncate font-mono">{name}</code>
  </SummaryRow>
);

/**
 * Before the first deploy on the network picked (Spec 08's EMPTY-03, Spec
 * 03's "Deploy stage before a deploy"): the facts of the deploy in one card of
 * rows, as review screens set them (PayPal, Remote, v0), not a stack of
 * centred lines. The network row carries Change; the IDL in use is a fact
 * here, not a note beside its button; who pays follows the facts in Spec 03's
 * words, and the program id closes the card.
 */
const BeforeDeploySummary = ({
  p,
  running,
}: {
  p: BaseDeployProps;
  running: boolean;
}) => (
  // 24 px under the title and its line (the stage's 16 and 8 more): the
  // facts are a group of their own
  <div className="mt-2 w-full max-w-[28rem] shrink-0 overflow-hidden rounded-xl border border-border bg-surface-panel text-left">
    <dl className="m-0 divide-y divide-border">
      {p.cluster && (
        <SummaryRow name="Network" label="Network">
          <StatusDot />
          {networkName(p.cluster)}
          <Button
            variant="link"
            size="xs"
            // The value's own type and line, no edge, on the row's baseline;
            // the link's colour, so the action reads apart from the fact
            className="ml-2 h-auto border-0 px-1 py-0 text-[length:inherit] leading-[inherit]"
            // A deploy keeps the network it started on
            disabled={running}
            onClick={p.onChangeNetwork}
          >
            Change
          </Button>
        </SummaryRow>
      )}
      {p.idlName && <IdlRow name={p.idlName} />}
    </dl>
    {p.built && !running && (
      <p
        aria-label="Who pays"
        className="m-0 border-t border-border px-4 py-2.5 text-caption font-read text-muted-foreground"
      >
        {payerLine(p)}
      </p>
    )}
    {/* The last row: the program id, which unfolds into its keypair */}
    <div className="border-t border-border">{p.programKeypair}</div>
  </div>
);

/**
 * The mainnet warning's body, its "deploy from your own machine" turned into
 * the button that opens the CLI deploy guide; the words stay the terminal's
 */
const MainnetWarningBody = ({ p }: { p: BaseDeployProps }) => {
  const [before, after] = MAINNET_DEPLOY_WARNING_BODY.split(
    MAINNET_DEPLOY_WARNING_GUIDE
  );
  return (
    <>
      {before}
      <Button
        variant="link"
        className="inline h-auto p-0 align-baseline text-[length:inherit] whitespace-normal"
        onClick={() => p.onOpenCliGuide("mainnet-warning")}
      >
        {MAINNET_DEPLOY_WARNING_GUIDE}
      </Button>
      {after}
    </>
  );
};

/**
 * The Deploy stage, drawn from props alone; `Deploy` connects it. It reads
 * the network picked now: before the first deploy there it is the
 * prototype's empty stage, centred: the summary, then History when other
 * networks have deployments, then the pill, Go to Build until there is a
 * build. "Upload IDL" and "Deploy with the CLI" follow the pill on a desk and
 * sit above the pinned foot on a phone. After a deploy it shows the result
 * and the history, read from the left. The CLI guide's button shows on every
 * cluster.
 */
const BaseDeploy = (p: BaseDeployProps) => {
  // Each network keeps its own deployments: the stage reads only the
  // network picked now, so a program deployed elsewhere leaves it empty here.
  // History still lists every network, each row under its own.
  const onNetwork = p.history.filter((r) => r.cluster === p.cluster);
  const latest = onNetwork[0];
  const n = onNetwork.length;
  // Before the first deploy here the summary's Network row names the
  // network, with Change; after one the meta line names it and counts the
  // deployments
  const meta = latest
    ? [
        p.cluster && networkName(p.cluster),
        `${n} deployment${n === 1 ? "" : "s"}`,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";
  const elsewhere = p.built ? deployedElsewhere(p, latest) : undefined;
  const running = p.deploy === "running";

  return (
    <div className={STAGE_FRAME}>
      <StageEmpty className={cn(STAGE_BODY, latest && STAGE_REPORT)}>
        {latest && (
          <StageEmptyMedia>
            <Rocket />
          </StageEmptyMedia>
        )}
        <StageEmptyTitle>{title(p, latest)}</StageEmptyTitle>
        {meta && <StageEmptyMeta>{meta}</StageEmptyMeta>}
        {elsewhere ? (
          <ElsewhereLine p={p} elsewhere={elsewhere} />
        ) : (
          <StageEmptyDescription>
            {description(p, latest)}
          </StageEmptyDescription>
        )}
        {!latest && <BeforeDeploySummary p={p} running={running} />}
        {latest && p.built && !running && (
          <p
            aria-label="Who pays"
            className="text-caption text-muted-foreground"
          >
            {payerLine(p)}
          </p>
        )}

        {p.funding && (
          <BaseNotEnoughSol
            cluster={p.cluster ?? undefined}
            reason={p.funding.reason}
            balance={p.funding.balance}
            needed={p.funding.needed}
            address={p.funding.address}
            cause={p.funding.cause}
            onRetry={p.onDeploy}
            onSignIn={p.onSignIn}
          />
        )}
        {p.deploy === "failed" && !p.funding && (
          <Callout variant="error" role="alert">
            <CalloutDescription>
              Could not deploy. The full log has the details.
            </CalloutDescription>
          </Callout>
        )}
        {warnsOnDeploy(p.cluster) && (
          <Callout variant="warning" aria-label="Mainnet deploy warning">
            <TriangleAlert />
            <CalloutTitle>{MAINNET_DEPLOY_WARNING_TITLE}</CalloutTitle>
            <CalloutDescription>
              <MainnetWarningBody p={p} />
            </CalloutDescription>
          </Callout>
        )}
        {latest && <DeployResult latest={latest} p={p} />}
        {p.history.length > 0 && <History p={p} />}
        {latest && (
          // After a deploy the summary's card keeps what can still change:
          // the IDL, replaceable from this stage, and the id
          <div className="w-full max-w-[28rem] shrink-0 overflow-hidden rounded-xl border border-border bg-surface-panel text-left">
            {p.idlName && (
              <dl className="m-0 border-b border-border">
                <IdlRow name={p.idlName} />
              </dl>
            )}
            {p.programKeypair}
          </div>
        )}
        <BaseStaleBuildDialog
          open={p.staleBuild}
          onAnswer={p.onStaleBuildAnswer}
        />
        {/* The other ways on, one kind of button: outlines in the
            pill's height and shape. On a desk they follow the pill (`order`);
            on a phone they stay in the page, above the foot, and only the
            pill is pinned, as review screens pin their one action */}
        <div className="flex flex-wrap items-center justify-center gap-2 md:order-last max-md:grid max-md:w-full max-md:grid-cols-2 max-md:[&_[data-variant=outline]]:w-full max-md:[&_[data-variant=outline]]:px-3 max-md:[&_button]:text-sm! max-md:[&>span]:w-full max-md:[&>span>div]:w-full [&_[data-variant=outline]]:h-10 [&_[data-variant=outline]]:rounded-full [&_[data-variant=outline]]:px-5">
          {offersRetry(p) && (
            <Button variant="outline" onClick={p.onShowLog}>
              Show full log
            </Button>
          )}
          {p.idlUpload}
          <Button
            variant="outline"
            onClick={() => p.onOpenCliGuide("deploy-stage")}
          >
            Deploy with the CLI
          </Button>
        </div>
        <StageEmptyActions
          // On a phone the foot is solid, so the history scrolling under it
          // never shows through; no rule, which over an empty stage only
          // cut the pill off from the page
          className={cn(STAGE_FOOT, "max-md:bg-background max-md:bg-none")}
        >
          {running && p.run.step && <BaseDeployProgress state={p.run} />}
          {/* One pill, the way on: Go to Build until there is a build, then
              the deploy. A faded Deploy beside a link read as three kinds of
              button for two steps */}
          {p.built ? (
            <BrandButton
              disabled={running}
              aria-busy={running || undefined}
              title={deployBlockedReason(p)}
              onClick={p.onDeploy}
            >
              {deployLabel(p, latest !== undefined)}
              {!running && <BrandButtonIcon />}
            </BrandButton>
          ) : (
            <BrandButton onClick={p.onGoToBuild}>
              Go to Build
              <BrandButtonIcon />
            </BrandButton>
          )}
        </StageEmptyActions>
      </StageEmpty>
    </div>
  );
};

export default BaseDeploy;
