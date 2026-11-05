import BN from "bn.js";
import { Fragment, useEffect, useRef, useState } from "react";

import { cn } from "@/shared/lib/utils";

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
  /**
   * The network, as said inside a sentence, whose SOL the fee payer lacks
   * for one fee; every card's Test waits for it and says so
   */
  solNeededOn?: string;
}

/**
 * A deployed program's instructions as cards that fold on their own, the
 * last call's result under the card that made it, and the calls before it in
 * a column beside them on a wide stage (under them on a narrow one), then
 * the account and event lookups.
 */
const InteractBody = ({
  idl,
  programId,
  cluster,
  solNeededOn,
}: InteractBodyProps) => {
  // Used for both accounts and events data
  useBigNumberJson();
  useSyncInstructionStorage();

  const names = idl.instructions.map((ix) => ix.name);
  // Every card folded on arrival, each one folding on its own (Almaz's card
  // from hoodieshq PR 272); a name a rebuild dropped simply matches no card
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = (name: string, isOpen: boolean) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (isOpen) next.add(name);
      else next.delete(name);
      return next;
    });

  // A history row opens its card and brings it into view once it has opened
  const cards = useRef(new Map<string, HTMLDivElement>());
  const [scrollTo, setScrollTo] = useState<{ name: string }>();
  useEffect(() => {
    if (scrollTo) {
      cards.current.get(scrollTo.name)?.scrollIntoView({ block: "nearest" });
    }
  }, [scrollTo]);
  const openFromHistory = (name: string) => {
    if (!names.includes(name)) return;
    toggle(name, true);
    setScrollTo({ name });
  };

  // Each card's last call, kept with the program and network it went to:
  // switching either hides it rather than showing it under another
  // program's card. One slot per card, so a result stays under the card
  // that made it
  const target = `${programId}|${cluster}`;
  const [results, setResults] = useState<
    Readonly<Record<string, { target: string; outcome: CallOutcome }>>
  >({});
  const resultOf = (name: string) =>
    results[name]?.target === target ? results[name].outcome : undefined;
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
            {/* The cards stack close, as the Test list on master does */}
            <div className="flex min-w-0 flex-col gap-2">
              {idl.instructions.map((idlInstruction) => {
                const outcome = resultOf(idlInstruction.name);
                return (
                  <Fragment key={idlInstruction.name}>
                    <div
                      ref={(el) => {
                        if (el) cards.current.set(idlInstruction.name, el);
                        else cards.current.delete(idlInstruction.name);
                      }}
                    >
                      <Instruction
                        key={JSON.stringify(idlInstruction)}
                        idlInstruction={idlInstruction}
                        open={open.has(idlInstruction.name)}
                        onOpenChange={(isOpen) =>
                          toggle(idlInstruction.name, isOpen)
                        }
                        solNeededOn={solNeededOn}
                        callBlocked={callInFlight}
                        feePayer={<FeePayer />}
                        onCall={async (ix) => {
                          const settled = await runCall(ix);
                          setResults((prev) => ({
                            ...prev,
                            [ix.name]: { target, outcome: settled },
                          }));
                        }}
                      />
                    </div>

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
                  </Fragment>
                );
              })}
            </div>

            <BaseCallHistory
              records={history}
              cluster={network}
              txUrl={txUrl}
              // A row of an instruction a rebuild removed leaves the cards alone
              onOpen={openFromHistory}
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
    <p className="m-0 text-xs text-muted-foreground">
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
