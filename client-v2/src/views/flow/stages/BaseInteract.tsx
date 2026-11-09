import type { ReactNode } from "react";

import { UNKNOWN_NETWORK } from "@/constants";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { BrandButton, BrandButtonIcon } from "@/shared/ui/brand-button";
import {
  Callout,
  CalloutAction,
  CalloutActions,
  CalloutDescription,
} from "@/shared/ui/callout";
import { CopyButton } from "@/shared/ui/copy-button";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select";
import {
  StageEmpty,
  StageEmptyActions,
  StageEmptyDescription,
  StageEmptyEyebrow,
  StageEmptyNotice,
  StageEmptyTitle,
} from "@/shared/ui/stage-empty";
import { StatusDot } from "@/shared/ui/status-dot";

import type { Stage } from "../state/stage";
import { clusterTitle } from "./cluster-title";
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
  /** The cluster's name for the program chip; undefined until the endpoint has been read */
  cluster: string | undefined;
  /** The cluster as a sentence names it ("devnet"); undefined until the endpoint has been read */
  network: string | undefined;
  onGoTo: (stage: Extract<Stage, "build" | "deploy">) => void;
  /** The "Upload IDL" action (`IdlActions mode="upload"`) */
  idlLoad: ReactNode;
  /** "Build the IDL locally", beside Upload IDL */
  idlGuide: ReactNode;
  /**
   * Why an Anchor IDL of spec 0.1.0 (Anchor 0.30 on) cannot be called
   * (`readIdl`'s reason), shown on the `bad-idl` surface; absent for any
   * other IDL
   */
  idlRefusal?: string;
  /** The form, drawn only on the `ready` surface */
  form: ReactNode;
  /** The program the calls go to; absent when there is none to name */
  programId: string | undefined;
  /** The code was built after the last deploy on this network */
  builtAfterDeploy: boolean;
  /** The fee payer cannot pay one fee; `airdrop` is absent without a faucet */
  solNeeded:
    | {
        balance: number;
        cluster: string;
        airdrop: (() => Promise<void>) | undefined;
      }
    | undefined;
}

type EmptySurface = Exclude<InteractSurface, "ready">;

/** What an empty surface says; `notice` is an error, shown as a callout */
interface EmptyCopy {
  title: string;
  description?: (network: string) => string;
  notice?: string;
}

/**
 * Spec 03's "Interact with nothing to call" (Spec 08's EMPTY-04). Before a
 * build and before a deploy Interact asks for the same step, a deploy, so the
 * two surfaces share it.
 */
const NOTHING_TO_CALL: EmptyCopy = {
  title: "Nothing to call yet",
  description: () => "Deploy the program, and its instructions show up here.",
};

const COPY: Record<EmptySurface, EmptyCopy> = {
  "no-project": {
    title: "No project open",
    description: () => "Open a project or start a new one to call its program.",
  },
  // Interact's own missing piece is a deployment, as the prototype says it;
  // Deploy then asks for the build
  "not-built": NOTHING_TO_CALL,
  "no-idl": {
    title: "This program has no IDL",
    description: () =>
      "The Playground's build does not produce an IDL. Build the IDL on your machine, then upload it to call the program's instructions.",
  },
  "no-program-id": {
    title: "No program id",
    description: () =>
      "The program has no public key. Building the program creates one.",
  },
  checking: {
    title: "Checking the program",
    description: (network) =>
      `Reading the program from ${network} to see whether it is deployed.`,
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
  "not-deployed": NOTHING_TO_CALL,
};

/**
 * Before a deploy, Upload IDL sits in the stage's foot beside Go to Deploy,
 * as it sits beside Deploy's pill, rather than in the toolbar: it is the
 * other way to something to call, a program deployed elsewhere
 */
const isNothingToCall = (surface: InteractSurface) =>
  surface === "not-built" || surface === "not-deployed";

/** The step that supplies what an empty surface lacks, if there is one */
const action = (p: BaseInteractProps, surface: EmptySurface): ReactNode => {
  if (surface === "no-program-id") {
    return (
      <BrandButton onClick={() => p.onGoTo("build")}>
        Go to Build
        <BrandButtonIcon />
      </BrandButton>
    );
  }
  if (isNothingToCall(surface)) {
    return (
      <>
        <BrandButton onClick={() => p.onGoTo("deploy")}>
          Go to Deploy
          <BrandButtonIcon />
        </BrandButton>
        {/* An outline in the pill's height and shape, so the pill keeps the
            focus, as Deploy's Upload IDL */}
        <div className="flex justify-center [&_[data-slot=button]]:h-10 [&_[data-slot=button]]:rounded-full [&_[data-slot=button]]:px-5 max-md:[&_[data-slot=button]]:h-12 max-md:[&_[data-slot=button]]:w-full max-md:[&>div]:w-full">
          {p.idlLoad}
          {p.idlGuide}
        </div>
      </>
    );
  }
  if (surface === "no-idl") {
    return (
      <>
        {p.idlLoad}
        {p.idlGuide}
      </>
    );
  }
  return undefined;
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
  const notice =
    surface === "bad-idl" && p.idlRefusal
      ? `This IDL uses ${p.idlRefusal}, which Interact cannot call yet.`
      : copy.notice;
  return (
    <StageEmpty className={STAGE_BODY}>
      {isNothingToCall(surface) && p.cluster && (
        // The network nothing is deployed on, as Deploy's stage names it
        <StageEmptyEyebrow>
          <StatusDot />
          {clusterTitle(p.cluster)}
        </StageEmptyEyebrow>
      )}
      <StageEmptyTitle>{copy.title}</StageEmptyTitle>
      {copy.description && (
        <StageEmptyDescription>
          {copy.description(p.network ?? UNKNOWN_NETWORK)}
        </StageEmptyDescription>
      )}
      {notice && (
        <StageEmptyNotice>
          <Callout variant="error">
            <CalloutDescription>{notice}</CalloutDescription>
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
  // eslint-disable-next-line unicorn/no-null -- a React component renders nothing with null
  if (!p.builtAfterDeploy && !p.solNeeded) return null;
  return (
    <div className="flex max-w-[42rem] flex-col gap-3 px-6 pt-6">
      {p.builtAfterDeploy && (
        <Callout variant="warning">
          <CalloutDescription>
            The deployed program is older than your code. Redeploy to call the
            latest version.
          </CalloutDescription>
          <CalloutActions>
            <CalloutAction onClick={() => p.onGoTo("deploy")}>
              Redeploy
            </CalloutAction>
          </CalloutActions>
        </Callout>
      )}
      {p.solNeeded && (
        <Callout variant="warning">
          <CalloutDescription>
            {`This call needs a small fee in ${p.solNeeded.cluster} SOL. Your wallet has ${p.solNeeded.balance} SOL.`}
          </CalloutDescription>
          {p.solNeeded.airdrop && (
            <CalloutActions>
              <CalloutAction asChild>
                <AsyncButton
                  variant="ghost"
                  size="sm"
                  onClick={p.solNeeded.airdrop}
                  onError={reportButtonFailure(
                    `get ${p.solNeeded.cluster} SOL`
                  )}
                >
                  Get {p.solNeeded.cluster} SOL
                </AsyncButton>
              </CalloutAction>
            </CalloutActions>
          )}
        </Callout>
      )}
    </div>
  );
};

/** The program the stage calls, shortened, with copy, and its network */
const Program = ({
  id,
  cluster,
}: {
  id: string;
  cluster: string | undefined;
}) => (
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

/**
 * The Interact stage drawn from props: the toolbar, then the form or why
 * there is none. The toolbar is the prototype's: the title row with the
 * program under it, then the deployment picker and the upload on a row of
 * their own. On a phone the tab above already says Interact, so the head is
 * that one row, the picker at the start and the upload at the end.
 */
const BaseInteract = (p: BaseInteractProps) => (
  <div className="flex h-full flex-col">
    <div className="flex flex-col items-start gap-4 border-b border-border px-6 py-3 max-md:min-h-15 max-md:justify-center max-md:py-2 max-md:pr-2 max-md:pl-5">
      <div className="flex flex-col gap-1 max-md:hidden">
        <div className="flex flex-wrap items-baseline gap-2.5">
          <h2 className="m-0 text-[1.75rem] leading-tight font-headline tracking-tight">
            Interact
          </h2>
          <span className="font-mono text-sm text-muted-foreground">
            {p.meta}
          </span>
        </div>
        {p.surface === "ready" && p.programId && (
          <Program id={p.programId} cluster={p.cluster} />
        )}
      </div>
      <div className="flex flex-wrap items-center gap-4 max-md:w-full max-md:flex-nowrap max-md:justify-between max-md:gap-2">
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Deployment
          <NativeSelect
            className="[&_select]:font-mono [&_select]:text-xs [&_select]:tabular-nums max-md:[&_select]:h-11!"
            value={p.selected ?? ""}
            onChange={(ev) => p.onPick(ev.target.value)}
            disabled={p.deployments.length === 0}
          >
            {p.deployments.length === 0 && (
              <NativeSelectOption value="">None yet</NativeSelectOption>
            )}
            {p.deployments.map((d) => (
              <NativeSelectOption key={d.id} value={d.id}>
                {d.label}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        </label>
        {/* In `no-idl` and before a deploy the stage's own foot offers it */}
        {p.surface !== "no-idl" && !isNothingToCall(p.surface) && (
          <>
            {p.idlLoad}
            {p.idlGuide}
          </>
        )}
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
