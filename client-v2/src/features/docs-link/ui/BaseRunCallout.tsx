import { CircleAlert, CircleCheck, Info, Wallet } from "lucide-react";
import type { FC, ReactNode } from "react";

import { Button } from "@/shared/ui/button";
import { Callout, CalloutDescription, CalloutTitle } from "@/shared/ui/callout";
import { CopyButton } from "@/shared/ui/copy-button";

import type { RunState } from "../model/run";

/** Where the open project came from, when a docs link opened it */
export interface RunSourceInfo {
  title: string;
  /** The page the link came from, already checked to be `https:` */
  from?: string;
}

/** Where "Get devnet SOL" goes until Playground has a faucet of its own */
export const FAUCET_URL = "https://faucet.solana.com";

export interface BaseRunCalloutProps {
  state: RunState;
  /** Absent when no docs link opened the project */
  source?: RunSourceInfo;
  onRunAgain: () => void;
  onCheckAgain: () => void;
  onNotNow: () => void;
  onCopyError: (error: unknown) => void;
}

const hostOf = (from: string) => new URL(from).hostname;

const sol = (amount: number) => `${Number(amount.toFixed(4))} SOL`;

interface NoteProps {
  /** The callout's `data-state`, which the tests and the stand read */
  state: string;
  variant: "info" | "success" | "error";
  icon: ReactNode;
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
}

/** One of the callout's plain states: an icon, a title, a line, buttons */
const Note: FC<NoteProps> = ({
  state,
  variant,
  icon,
  title,
  children,
  actions,
}) => (
  <Callout
    id="client-run-callout"
    data-state={state}
    variant={variant}
    className="mb-2"
  >
    {icon}
    <CalloutTitle>{title}</CalloutTitle>
    <CalloutDescription>
      {children}
      {actions && <div className="mt-2 flex gap-2">{actions}</div>}
    </CalloutDescription>
  </Callout>
);

/**
 * The one note above the code of a project with no program: where it came
 * from before a run, how the run ended after it, or what it needs to run.
 */
const BaseRunCallout: FC<BaseRunCalloutProps> = ({
  state,
  source,
  onRunAgain,
  onCheckAgain,
  onNotNow,
  onCopyError,
}) => {
  const again = (
    <Button variant="outline" size="xs" onClick={onRunAgain}>
      Run again
    </Button>
  );

  // A run in progress keeps showing what was there before it
  const shown = state.kind === "running" ? state.previous : state;
  switch (shown.kind) {
    case "idle": {
      // eslint-disable-next-line unicorn/no-null -- a component that draws nothing returns `null`; React's types refuse `undefined`
      if (!source) return null;
      const where = source.from ? hostOf(source.from) : "a docs link";
      return (
        <Note
          state="source"
          variant="info"
          icon={<Info />}
          title={`From ${where}: ${source.title}`}
        >
          Runs with your Playground wallet.{" "}
          {source.from && (
            <a
              className="underline underline-offset-4"
              href={source.from}
              target="_blank"
              rel="noopener noreferrer"
            >
              View the docs page
            </a>
          )}
        </Note>
      );
    }

    case "done":
      return (
        <Note
          state="done"
          variant="success"
          icon={<CircleCheck />}
          title={`Ran in ${Math.round(shown.ms / 1000)} s`}
          actions={again}
        >
          Signatures and Explorer links are in the terminal.
        </Note>
      );

    case "failed":
      return (
        <Note
          state="failed"
          variant="error"
          icon={<CircleAlert />}
          title="Run failed"
          actions={again}
        >
          {shown.message}
        </Note>
      );

    case "missing-package":
      return (
        <Note
          state="missing-package"
          variant="error"
          icon={<CircleAlert />}
          title={
            <>
              Playground can't load <code>{shown.pkg}</code> yet
            </>
          }
        >
          This script imports it, so nothing ran.
        </Note>
      );

    case "funding":
      return (
        <Callout
          id="client-run-callout"
          data-state="funding"
          variant="warning"
          className="mb-2"
        >
          <Wallet />
          <CalloutTitle>Not enough SOL on devnet</CalloutTitle>
          <CalloutDescription>
            <div id="client-run-funding">
              <p>
                This script pays a few small fees. Your Playground wallet needs
                about {sol(shown.needed)}.
              </p>
              <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 font-mono text-xs">
                <dt>Wallet</dt>
                <dd className="truncate">{shown.address}</dd>
                <dt>Balance</dt>
                <dd>{sol(shown.balance)}</dd>
                <dt>Needed</dt>
                <dd>{sol(shown.needed)}</dd>
              </dl>
              <div className="mt-2 flex flex-wrap gap-2">
                <Button size="xs" asChild>
                  <a
                    href={FAUCET_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Get devnet SOL
                  </a>
                </Button>
                <CopyButton
                  value={shown.address}
                  label="Copy address"
                  onError={onCopyError}
                />
                <Button variant="outline" size="xs" onClick={onCheckAgain}>
                  Check again
                </Button>
                <Button variant="ghost" size="xs" onClick={onNotNow}>
                  Not now
                </Button>
              </div>
            </div>
          </CalloutDescription>
        </Callout>
      );
  }
};

export default BaseRunCallout;
