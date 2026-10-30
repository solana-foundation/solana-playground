import {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useState,
} from "react";

import InstructionInput from "./InstructionInput";
import InstructionProvider from "./InstructionProvider";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import { PgCommon } from "../../../../../utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import {
  GeneratableInstruction,
  IdlInstruction,
  PgProgramInteraction,
} from "../../.././../../utils/program-interaction";
import { useWallet } from "../../../../../hooks";
import { useIdl } from "../IdlProvider";

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
          disabled={!wallet || disabled || callBlocked}
          loadingText="Calling…"
        >
          Call {instruction.name}
        </AsyncButton>

        {(instruction.values.accounts.length > 0 ||
          instruction.values.args.length > 0) && (
          <>
            <Button variant="outline" onClick={fillRandom} disabled={calling}>
              Fill
            </Button>
            <Button variant="outline" onClick={reset} disabled={calling}>
              Reset
            </Button>
          </>
        )}
      </div>
    </InstructionProvider>
  );
};

export default Instruction;
