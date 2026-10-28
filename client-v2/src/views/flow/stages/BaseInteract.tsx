import type { ReactNode } from "react";

import { BrandButton, BrandButtonIcon } from "@/shared/ui/brand-button";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { NativeSelect, NativeSelectOption } from "@/shared/ui/native-select";
import {
  StageEmpty,
  StageEmptyActions,
  StageEmptyDescription,
  StageEmptyNotice,
  StageEmptyTitle,
} from "@/shared/ui/stage-empty";
import type { Stage } from "../state/stage";
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
  /** The "Upload IDL" action (`IdlActions mode="upload"`) */
  idlLoad: ReactNode;
  /** The form, drawn only on the `ready` surface */
  form: ReactNode;
}

type EmptySurface = Exclude<InteractSurface, "ready">;

/** What an empty surface says; `notice` is an error, shown as a callout */
interface EmptyCopy {
  title: string;
  description?: (cluster: string) => string;
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
    title: "No IDL yet",
    description: () =>
      "This program's Anchor IDL was not found. Upload the IDL file to call its instructions.",
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
  "not-deployed": NOTHING_TO_CALL,
};

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
  if (surface === "not-built" || surface === "not-deployed") {
    return (
      <BrandButton onClick={() => p.onGoTo("deploy")}>
        Go to Deploy
        <BrandButtonIcon />
      </BrandButton>
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

/**
 * The Interact stage drawn from props: the toolbar, then the form or why
 * there is none. The toolbar is the prototype's: the title row, then the
 * deployment picker and the upload on a row of their own under it. On a
 * phone the tab above already says Interact, so the head is that one row,
 * the picker at the start and the upload at the end.
 */
const BaseInteract = (p: BaseInteractProps) => (
  <div className="flex h-full flex-col">
    <div className="flex flex-col items-start gap-4 border-b border-border px-6 py-3 max-md:min-h-15 max-md:justify-center max-md:py-2 max-md:pr-2 max-md:pl-5">
      <div className="flex flex-wrap items-baseline gap-2.5 max-md:hidden">
        <h2 className="m-0 text-[1.75rem] leading-tight font-medium tracking-tight">
          Interact
        </h2>
        <span className="font-mono text-sm text-muted-foreground">
          {p.meta}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-4 max-md:w-full max-md:flex-nowrap max-md:justify-between max-md:gap-2">
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
      {p.surface === "ready" ? p.form : <Empty p={p} surface={p.surface} />}
    </div>
  </div>
);

export default BaseInteract;
