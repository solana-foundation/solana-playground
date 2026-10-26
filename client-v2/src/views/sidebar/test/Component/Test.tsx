import { useEffect } from "react";
import BN from "bn.js";

import Account from "./Account";
import Event from "./Event";
import Instruction from "./Instruction";
import IdlProvider from "./IdlProvider";
import { PgProgramInfo } from "../../../../utils";
import {
  Idl,
  PgProgramInteraction,
} from "../../../../utils/program-interaction";

/**
 * The form for a deployed program's instructions, accounts and events. The
 * Interact stage draws it only once `interactSurface` is `ready`, and redraws
 * it with every new `idl`, so it needs no build event of its own.
 */
const Test = ({ idl }: { idl: Idl }) => {
  // Used for both accounts and events data
  useBigNumberJson();

  // Handle instruction storage
  useSyncInstructionStorage();

  return (
    <IdlProvider idl={idl}>
      <div className="flex max-w-[42rem] flex-col gap-6 px-6 py-6 select-none">
        <p className="m-0 font-mono text-xs text-muted-foreground">
          Program: <span className="text-foreground">{idl.name}</span>
        </p>

        <Section title="Instructions">
          {idl.instructions.map((ix, i) => (
            <Instruction key={JSON.stringify(ix)} idlInstruction={ix} />
          ))}
        </Section>

        {idl.accounts && (
          <Section title="Accounts">
            {idl.accounts.map((acc, i) => (
              <Account key={acc.name} accountName={acc.name} />
            ))}
          </Section>
        )}

        {idl.events && (
          <Section title="Events">
            {idl.events.map((event, i) => (
              <Event key={event.name} eventName={event.name} />
            ))}
          </Section>
        )}
      </div>
    </IdlProvider>
  );
};

/** A headed list of cards: the instructions, the accounts or the events */
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
    const { dispose } = PgProgramInfo.onDidChangeIdl((idl) => {
      if (idl) PgProgramInteraction.syncAllInstructions(idl.instructions);
    });
    return dispose;
  }, []);
};

export default Test;

// Initial thought process when implementing tests.

// If we have the IDL:
// 1. We can show all the callable methods.
// 2. For each function we can only populate the known
// accounts like system_program or clock.

// This is a big problem for more complex methods if we don't
// allow users to write their own ts implementation to calculate
// the needed accounts.

// One solution would be to implement ts support for tests so that
// the users can write their own scripts to do the testing directly
// on the browser. But this is also problematic since our goal is
// to make this app as easy as possible to use. It would be better
// for us to implement testing features with ui only so that users
// can just easily do their testing without needing to write a script.
// More advanced users can choose to go with the scripting route.

// The ui can have a custom ix builder to build txs that require
// let's say a token account creation as a preInstruction. The users
// would be able to choose how to create each account or put the
// publicKey manually.
