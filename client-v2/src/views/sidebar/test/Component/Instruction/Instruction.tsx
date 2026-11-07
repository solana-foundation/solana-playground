import {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import { useNetworkHold } from "@/widgets/status";

import { useWallet } from "../../../../../hooks";
import { PgCommon } from "../../../../../utils";
import {
  GeneratableInstruction,
  IdlInstruction,
  PgProgramInteraction,
} from "../../.././../../utils/program-interaction";
import { useIdl } from "../IdlProvider";
import { hasInstructionErrors } from "./instruction-errors";
import InstructionInput from "./InstructionInput";
import InstructionProvider from "./InstructionProvider";

interface InstructionProps {
  idlInstruction: IdlInstruction;
  /** Sends the instruction; the form stays locked until it settles */
  onCall: (ix: GeneratableInstruction) => Promise<unknown>;
  /** Keeps Call off for a reason outside the form, such as too little SOL */
  callBlocked?: boolean;
  /** Who pays the fee, drawn above the actions */
  feePayer?: ReactNode;
}

/** One instruction's form: its arguments, its accounts, and Call */
const Instruction: FC<InstructionProps> = ({
  idlInstruction,
  onCall,
  callBlocked,
  feePayer,
}) => {
  const [instruction, setInstruction] = useState(() =>
    PgProgramInteraction.getOrCreateInstruction(idlInstruction)
  );
  const [disabled, setDisabled] = useState(true);
  const [calling, setCalling] = useState(false);
  const [refreshCount, refreshFields] = useReducer((r) => r + 1, 0);

  const { idl } = useIdl();

  // Enable when there is no args and no accounts.
  //
  // This is intentionally done in a `useEffect` instead of changing the
  // setting the default value of the `disabled`'s `useState` in order to:
  // - Enable the button when `idlInstruction` changes
  // - Avoid flickering of the Call button i.e. the button renders as enabled
  // and switches to disabled state after.
  useEffect(() => {
    if (!idlInstruction.args.length && !idlInstruction.accounts.length) {
      setDisabled(false);
    }
  }, [idlInstruction]);

  // Check the values the instruction was restored with. The inputs report
  // only what the user edits, so a valid form that comes back after a switch
  // to another instruction would otherwise keep Call off until a field changes.
  useEffect(() => {
    setDisabled(hasInstructionErrors(instruction.values));
    // Once, for the values the form mounted with
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refresh instruction in order to pass the latest generators to
  // `InstructionInput`, otherwise the initial values are being generated
  // from stale data.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const refresh = useCallback(
    PgCommon.debounce(() => setInstruction((ix) => ({ ...ix })), {
      delay: 1000,
    }),
    []
  );

  // Save instruction on change
  useEffect(
    () => PgProgramInteraction.saveInstruction(instruction),
    [instruction]
  );

  // Fill empty fields with Random generator
  const fillRandom = useCallback(() => {
    setInstruction((ix) => PgProgramInteraction.fillRandom(ix, idl));

    // Refresh fields in order to re-render mapped elements
    refreshFields();
  }, [idl]);

  // Reset the current instruction and re-crate it from default values
  const reset = useCallback(() => {
    // Reset and re-crate instruction
    setInstruction((ix) => {
      PgProgramInteraction.resetInstruction(ix);
      return PgProgramInteraction.getOrCreateInstruction(idlInstruction);
    });

    // Refresh fields in order to re-render mapped elements
    refreshFields();
  }, [idlInstruction]);

  const call = async () => {
    setCalling(true);
    try {
      await onCall(instruction);
    } finally {
      setCalling(false);
    }
  };

  const wallet = useWallet();
  const network = useNetworkHold();
  // A block from outside the form says itself, in the stage's callout
  const held = callBlocked
    ? undefined
    : heldBecause({ network, wallet: !!wallet, filled: !disabled });

  return (
    <InstructionProvider
      instruction={instruction}
      setInstruction={setInstruction}
    >
      <fieldset
        disabled={calling}
        className="m-0 flex min-w-0 flex-col gap-4 border-0 p-0"
      >
        {instruction.values.args.length > 0 && (
          <Collapsible defaultOpen>
            <CollapsibleHeading>
              <CollapsibleChevron />
              Args
            </CollapsibleHeading>
            <CollapsibleContent className="mt-2">
              <div className="flex flex-col gap-3 text-xs">
                {instruction.values.args.map((arg) => (
                  <InstructionInput
                    key={arg.name + refreshCount}
                    prefix="args"
                    updateInstruction={({
                      updateGenerator,
                      updateRefs,
                      checkErrors,
                    }) => {
                      updateGenerator(arg);
                      updateRefs(arg, "Arguments");
                      setDisabled(checkErrors());
                      refresh();
                    }}
                    {...arg}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}

        {instruction.values.accounts.length > 0 && (
          <Collapsible defaultOpen>
            <CollapsibleHeading>
              <CollapsibleChevron />
              Accounts
            </CollapsibleHeading>
            <CollapsibleContent className="mt-2">
              <div className="flex flex-col gap-3 text-xs">
                {instruction.values.accounts.map((acc) => (
                  <InstructionInput
                    key={acc.name + refreshCount}
                    prefix="accounts"
                    type="publicKey"
                    updateInstruction={({
                      updateGenerator,
                      updateRefs,
                      checkErrors,
                    }) => {
                      updateGenerator(acc);
                      updateRefs(acc, "Accounts");
                      setDisabled(checkErrors());
                      refresh();
                    }}
                    {...acc}
                  />
                ))}
              </div>
            </CollapsibleContent>
          </Collapsible>
        )}
      </fieldset>

      {feePayer}

      <div className="mt-4 flex flex-wrap gap-2">
        <AsyncButton
          onClick={call}
          onError={reportButtonFailure(`call ${instruction.name}`)}
          disabled={callBlocked || held !== undefined}
          loadingText="Calling…"
        >
          Call {instruction.name}
        </AsyncButton>

        {(instruction.values.accounts.length > 0 ||
          instruction.values.args.length > 0) && (
          // When the row is too narrow for all three buttons, Fill and Reset
          // wrap together under Call rather than leaving Reset alone
          <div className="flex gap-2">
            <Button variant="outline" onClick={fillRandom} disabled={calling}>
              Fill
            </Button>
            <Button variant="outline" onClick={reset} disabled={calling}>
              Reset
            </Button>
          </div>
        )}

        {held && (
          <p className="m-0 self-center text-caption text-muted-foreground">
            {held}
          </p>
        )}
      </div>
    </InstructionProvider>
  );
};

/**
 * Why Call is held, said beside it (`client-v2-stages`, "says what it waits
 * for"); undefined once it can run
 */
const heldBecause = ({
  network,
  wallet,
  filled,
}: {
  network: string | undefined;
  wallet: boolean;
  filled: boolean;
}) => {
  if (network) return network;
  if (!wallet) return "Connect a wallet to call";
  if (!filled) return "Fill every field to call";
  return undefined;
};

export default Instruction;
