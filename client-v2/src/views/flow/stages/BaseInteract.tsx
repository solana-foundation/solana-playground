import type { ReactNode } from "react";
import { MousePointerClick } from "lucide-react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { BrandButton } from "@/shared/ui/brand-button";
import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { CopyButton } from "@/shared/ui/copy-button";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select";
import {
  StageEmpty,
  StageEmptyActions,
  StageEmptyDescription,
  StageEmptyMedia,
  StageEmptyNotice,
  StageEmptyTitle,
} from "@/shared/ui/stage-empty";
import type { Stage } from "../state/stage";
import { shortenId } from "./interact-callouts";
import type { InteractSurface } from "./interact-surface";
import { STAGE_BODY, STAGE_FOOT, STAGE_FRAME } from "./stage-layout";

/** One deployment in the toolbar's picker */
export interface DeploymentOption {
  id: string;
  label: string;
}

export interface BaseInteractProps {
  /** The toolbar's mono meta line, e.g. "latest · devnet · 6PNd..." */
  meta: string;
  deployments: DeploymentOption[];
  selected: string | null;
  onPick: (id: string) => void;
  surface: InteractSurface;
  /** The cluster for prose; null until the endpoint has been read */
  cluster: string | null;
  onGoTo: (stage: Extract<Stage, "build" | "deploy">) => void;
  /** The "Load IDL file" action (`IdlActions mode="button"`) */
  idlLoad: ReactNode;
  /** The form, drawn only on the `ready` surface */
  form: ReactNode;
  /** The program the calls go to; null when there is none to name */
  programId: string | null;
  /** The code was built after the last deploy on this network */
  builtAfterDeploy: boolean;
  /** The fee payer cannot pay one fee; `airdrop` is null without a faucet */
  solNeeded: {
    balance: number;
    cluster: string;
    airdrop: (() => Promise<void>) | null;
  } | null;
}

type EmptySurface = Exclude<InteractSurface, "ready">;

/** What an empty surface says; `notice` is an error, shown as a callout */
interface EmptyCopy {
  title: string;
  description?: (cluster: string) => string;
  notice?: string;
}

const COPY: Record<EmptySurface, EmptyCopy> = {
  "no-project": {
    title: "No project open",
    description: () => "Open a project or start a new one to call its program.",
  },
  "not-built": {
    title: "Nothing to call yet",
    description: () =>
      "Build the program first. Once it is deployed, its instructions show up here, ready to call.",
  },
  "no-idl": {
    title: "No IDL yet",
    description: () =>
      "This program's Anchor IDL was not found. Load the IDL file to call its instructions.",
  },
  "no-program-id": {
    title: "No program id",
    description: () =>
      "The program has no public key. Building the program creates one.",
  },
  checking: {
    title: "Checking the program",
    description: (cluster) =>
      `Reading the program from ${cluster} to see whether it is deployed.`,
  },
  "bad-idl": {
    title: "This IDL can't be read",
    notice:
      "You've imported a corrupted IDL. Please double check you've imported an Anchor IDL.",
  },
  unreachable: {
    title: "Can't reach the network",
    notice:
      "Connection error. Please try changing the RPC endpoint from the settings.",
  },
  "not-deployed": {
    title: "Nothing to call yet",
    description: (cluster) =>
      `Deploy the program first. Once it is on ${cluster}, its instructions show up here, ready to call.`,
  },
};

/** The step that supplies what an empty surface lacks, if there is one */
const action = (p: BaseInteractProps, surface: EmptySurface): ReactNode => {
  if (surface === "not-built" || surface === "no-program-id") {
    return (
      <BrandButton onClick={() => p.onGoTo("build")}>Go to Build</BrandButton>
    );
  }
  if (surface === "not-deployed") {
    return (
      <BrandButton onClick={() => p.onGoTo("deploy")}>Go to Deploy</BrandButton>
    );
  }
  if (surface === "no-idl") return p.idlLoad;
  return null;
};

const Empty = ({
  p,
  surface,
}: {
  p: BaseInteractProps;
  surface: EmptySurface;
}) => {
  const copy = COPY[surface];
  const act = action(p, surface);
  return (
    <StageEmpty className={STAGE_BODY}>
      <StageEmptyMedia>
        <MousePointerClick />
      </StageEmptyMedia>
      <StageEmptyTitle>{copy.title}</StageEmptyTitle>
      {copy.description && (
        <StageEmptyDescription>
          {copy.description(p.cluster ?? "the network")}
        </StageEmptyDescription>
      )}
      {copy.notice && (
        <StageEmptyNotice>
          <Callout variant="error">
            <CalloutDescription>{copy.notice}</CalloutDescription>
          </Callout>
        </StageEmptyNotice>
      )}
      {act && (
        <StageEmptyActions className={STAGE_FOOT}>{act}</StageEmptyActions>
      )}
    </StageEmpty>
  );
};

/** What stands between the person and a useful call, above the form */
const Callouts = ({ p }: { p: BaseInteractProps }) => {
  if (!p.builtAfterDeploy && !p.solNeeded) return null;
  return (
    <div className="flex max-w-[42rem] flex-col gap-3 px-6 pt-6">
      {p.builtAfterDeploy && (
        <Callout variant="warning">
          <CalloutDescription className="flex flex-wrap items-center justify-between gap-3">
            The deployed program is older than your code. Redeploy to call the
            latest version.
            <Button
              size="sm"
              variant="outline"
              onClick={() => p.onGoTo("deploy")}
            >
              Redeploy
            </Button>
          </CalloutDescription>
        </Callout>
      )}
      {p.solNeeded && (
        <Callout variant="warning">
          <CalloutDescription className="flex flex-wrap items-center justify-between gap-3">
            {`This call needs a small fee in ${p.solNeeded.cluster} SOL. Your wallet has ${p.solNeeded.balance} SOL.`}
            {p.solNeeded.airdrop && (
              <AsyncButton
                size="sm"
                variant="outline"
                onClick={p.solNeeded.airdrop}
                onError={reportButtonFailure(`get ${p.solNeeded.cluster} SOL`)}
              >
                Get {p.solNeeded.cluster} SOL
              </AsyncButton>
            )}
          </CalloutDescription>
        </Callout>
      )}
    </div>
  );
};

/** The program the stage calls, shortened, with copy, and its network */
const Program = ({ id, cluster }: { id: string; cluster: string | null }) => (
  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
    <span>Program</span>
    <code className="font-mono text-foreground" title={id}>
      {shortenId(id)}
    </code>
    <CopyButton
      value={id}
      label="Copy program id"
      onError={reportButtonFailure("copy the program id")}
    />
    {cluster && (
      <>
        <span aria-hidden="true">·</span>
        <span>{cluster}</span>
      </>
    )}
  </div>
);

/** The Interact stage drawn from props: the toolbar, then the form or why there is none */
const BaseInteract = (p: BaseInteractProps) => (
  <div className="flex h-full flex-col">
    <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-3">
      <div className="flex flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="m-0 text-xl font-semibold tracking-tight">Interact</h2>
          <span className="font-mono text-xs text-muted-foreground">
            {p.meta}
          </span>
        </div>
        {p.surface === "ready" && p.programId && (
          <Program id={p.programId} cluster={p.cluster} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Deployment
          <NativeSelect
            size="sm"
            className="[&_select]:font-mono [&_select]:text-xs [&_select]:tabular-nums"
            value={p.selected ?? ""}
            onChange={(ev) => p.onPick(ev.target.value)}
            disabled={p.deployments.length === 0}
          >
            {p.deployments.length === 0 && (
              <NativeSelectOption value="">none yet</NativeSelectOption>
            )}
            {p.deployments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {/* In `no-idl` the stage's own foot offers it */}
        {p.surface !== "no-idl" && p.idlLoad}
      </div>
    </div>
    <div className={STAGE_FRAME}>
      {p.surface === "ready" ? (
        <>
          <Callouts p={p} />
          {p.form}
        </>
      ) : (
        <Empty p={p} surface={p.surface} />
      )}
    </div>
  </div>
);

export default BaseInteract;
