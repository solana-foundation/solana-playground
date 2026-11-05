import BN from "bn.js";
import { useEffect, useState } from "react";

import { cn } from "@/shared/lib/utils";
import { Segmented, SegmentedItem } from "@/shared/ui/segmented";

import { clusterName, UNKNOWN_NETWORK } from "../../../constants";
import { useBalance, useBlockExplorer, useWallet } from "../../../hooks";
import { PgProgramInfo } from "../../../utils";
import { Idl, PgProgramInteraction } from "../../../utils/program-interaction";
import { PgAssistant } from "../../sidebar/assistant/store";
import Account from "../../sidebar/test/Component/Account";
import Event from "../../sidebar/test/Component/Event";
import IdlProvider from "../../sidebar/test/Component/IdlProvider";
import Instruction from "../../sidebar/test/Component/Instruction";
import type { CallRecord } from "../state/call-history";
import { PgCallHistory } from "../state/call-history";
import BaseCallHistory from "./BaseCallHistory";
import BaseCallResult from "./BaseCallResult";
import type { CallOutcome } from "./call-outcome";
import { explainPrompt } from "./call-outcome";
import { runCall, useCallInFlight } from "./run-call";

export interface InteractBodyProps {
  idl: Idl;
  /** The program the calls go to, for the history */
  programId: string | null;
  /** The network the calls go to; null until the endpoint has been read */
  cluster: string | null;
  /** Keeps Call off for a reason the stage shows, such as too little SOL */
  callBlocked?: boolean;
}

/**
 * A deployed program's instructions as chips, the picked one's form and the
 * last call's result, with the calls before it in a column beside them on a
 * wide stage (under them on a narrow one), then the account and event lookups.
 */
const InteractBody = ({
  idl,
  programId,
  cluster,
  callBlocked,
}: InteractBodyProps) => {
  // Used for both accounts and events data
  useBigNumberJson();
  useSyncInstructionStorage();

  const names = idl.instructions.map((ix) => ix.name);
  const [picked, setPicked] = useState<string>();
  // A pick the IDL no longer has (a rebuild renamed it) falls back to the first
  const current = picked && names.includes(picked) ? picked : names[0];
  const idlInstruction = idl.instructions.find((ix) => ix.name === current);

  // The last call, kept with the program and network it went to: switching
  // either hides it rather than showing it under another program's form
  const target = `${programId}|${cluster}`;
  const [last, setLast] = useState<{
    target: string;
    outcome: CallOutcome;
  }>();
  const outcome = last?.target === target ? last.outcome : undefined;
  const history = useCallHistory(programId, cluster);
  const callInFlight = useCallInFlight();
  const network = clusterName(cluster) ?? UNKNOWN_NETWORK;
  const explorer = useBlockExplorer();
  const txUrl = (sig: string) => explorer.getTxUrl?.(sig) ?? "";

  return (
    <IdlProvider idl={idl}>
      {/* The stage's own width decides the columns: the chat and Files panels
          beside it change that width, the viewport does not */}
      <div className="@container">
        <div className="flex max-w-[64.5rem] flex-col gap-6 px-6 py-6">
          <div
            data-slot="interact-columns"
            className="grid grid-cols-1 gap-6 @min-[40rem]:grid-cols-[minmax(0,42rem)_18rem]"
          >
            <div className="flex min-w-0 flex-col gap-6">
              {names.length > 0 && (
                <Segmented
                  variant="chips"
                  aria-label="Instruction"
                  value={current}
                  onValueChange={setPicked}
                >
                  {names.map((name) => (
                    <SegmentedItem
                      key={name}
                      value={name}
                      // A long name wraps inside the form's column: the
                      // history track starts right after it
                      className="h-auto min-h-7 max-w-full shrink py-1 text-left font-mono whitespace-normal [overflow-wrap:anywhere]"
                    >
                      {name}
                    </SegmentedItem>
                  ))}
                </Segmented>
              )}

              {idlInstruction && (
                <section
                  aria-label={`${idlInstruction.name} form`}
                  className="rounded-xl border border-border bg-surface-panel p-4"
                >
                  <Instruction
                    key={JSON.stringify(idlInstruction)}
                    idlInstruction={idlInstruction}
                    callBlocked={callBlocked || callInFlight}
                    feePayer={<FeePayer />}
                    onCall={async (ix) =>
                      setLast({ target, outcome: await runCall(ix) })
                    }
                  />
                </section>
              )}

              {outcome && (
                <BaseCallResult
                  outcome={outcome}
                  cluster={network}
                  txUrl={txUrl}
                  onExplain={(failed) =>
                    PgAssistant.requestPrompt(explainPrompt(failed))
                  }
                />
              )}
            </div>

            <BaseCallHistory
              records={history}
              cluster={network}
              txUrl={txUrl}
              // A row of an instruction a rebuild removed leaves the form alone
              onOpen={(name) => names.includes(name) && setPicked(name)}
              // The wide layout's history track is there before the first
              // call; the empty line keeps it from reading as a blank hole.
              // One column shows no history until then
              showEmpty
              className={cn(
                // Sticky beside a long form, and no taller than the stage's
                // view (the viewport less the app header and stage toolbar),
                // so its last rows stay reachable while it is pinned
                "@min-[40rem]:sticky @min-[40rem]:top-6 @min-[40rem]:max-h-[calc(100dvh-16rem)] @min-[40rem]:self-start",
                history.length === 0 && "@max-[40rem]:hidden"
              )}
            />
          </div>

          {idl.accounts && (
            <Section title="Accounts">
              {idl.accounts.map((acc) => (
                <Account key={acc.name} accountName={acc.name} />
              ))}
            </Section>
          )}

          {idl.events && (
            <Section title="Events">
              {idl.events.map((event) => (
                <Event key={event.name} eventName={event.name} />
              ))}
            </Section>
          )}
        </div>
      </div>
    </IdlProvider>
  );
};

/** Who pays the call's fee, and what they hold */
const FeePayer = () => {
  const wallet = useWallet();
  const balance = useBalance();
  // eslint-disable-next-line unicorn/no-null -- a React component renders nothing with null
  if (!wallet) return null;
  const who = wallet.isPg ? "Playground wallet" : wallet.name;
  const sol = typeof balance === "number" ? `${+balance.toFixed(4)} SOL` : "—";
  return (
    <p className="m-0 mt-4 text-xs text-muted-foreground">
      Fee payer · {who} · {sol}
    </p>
  );
};

/** A headed list of cards: the accounts or the events */
const Section = ({
  title,
  children,
}: React.PropsWithChildren<{ title: string }>) => (
  <section className="flex flex-col gap-2">
    <h3 className="m-0 text-xs font-medium tracking-wider text-muted-foreground uppercase">
      {title}
    </h3>
    {children}
  </section>
);

/** The calls to this program on this network, kept current */
const useCallHistory = (programId: string | null, cluster: string | null) => {
  const [records, setRecords] = useState<CallRecord[]>([]);
  useEffect(() => {
    if (!programId || !cluster) {
      setRecords([]);
      return;
    }
    const { dispose } = PgCallHistory.onDidChange(() =>
      setRecords(PgCallHistory.list(programId, cluster))
    );
    return dispose;
  }, [programId, cluster]);
  return records;
};

/**
 * Temporarily change `BN.toJSON` method to `BN.toString` in order to have
 * human-readable output rather than hex values.
 */
const useBigNumberJson = () => {
  useEffect(() => {
    const oldBNPrototypeToJSON = BN.prototype.toJSON;
    BN.prototype.toJSON = function (this: BN) {
      return this.toString();
    };

    // Change the toJSON prototype back on unmount
    return () => {
      BN.prototype.toJSON = oldBNPrototypeToJSON;
    };
  }, []);
};

/** Sync the instruction storage. */
const useSyncInstructionStorage = () => {
  useEffect(() => {
    const { dispose } = PgProgramInfo.onDidChangeIdl(() => {
      const idl = PgProgramInfo.callableIdl();
      if (idl) PgProgramInteraction.syncAllInstructions(idl.instructions);
    });
    return dispose;
  }, []);
};

export default InteractBody;
