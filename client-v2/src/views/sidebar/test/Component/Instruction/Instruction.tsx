import { FC, useCallback, useEffect, useReducer, useState } from "react";

import InstructionInput from "./InstructionInput";
import InstructionProvider from "./InstructionProvider";
import Interaction from "../Interaction";
import {
  Collapsible,
  CollapsibleChevron,
  CollapsibleContent,
  CollapsibleHeading,
} from "@/shared/ui/collapsible";
import { Emoji } from "../../../../../constants";
import {
  PgCommand,
  PgCommon,
  PgConnection,
  PgSettings,
  PgTerminal,
  PgTx,
} from "../../../../../utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import {
  IdlInstruction,
  PgProgramInteraction,
} from "../../.././../../utils/program-interaction";
import { useWallet } from "../../../../../hooks";
import { useIdl } from "../IdlProvider";

interface InstructionProps {
  idlInstruction: IdlInstruction;
}

const Instruction: FC<React.PropsWithChildren<InstructionProps>> = ({
  idlInstruction,
}) => {
  const [instruction, setInstruction] = useState(() =>
    PgProgramInteraction.getOrCreateInstruction(idlInstruction)
  );
  const [disabled, setDisabled] = useState(true);
  const [refreshCount, refreshFields] = useReducer((r) => r + 1, 0);

  const { idl } = useIdl();

  // Enable when there is no args and no accounts.
  //
  // This is intentionally done in a `useEffect` instead of changing the
  // setting the default value of the `disabled`'s `useState` in order to:
  // - Enable the button when `idlInstruction` changes
  // - Avoid flickering of the Test button i.e. the button renders as enabled
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

  const handleTest = async () => {
    const showLogTxHash = await PgTerminal.process(async () => {
      PgTerminal.println(PgTerminal.info(`Testing \`${instruction.name}\`...`));

      try {
        const txHash = await PgCommon.transition(
          PgProgramInteraction.test(instruction)
        );
        if (PgSettings.testUi.showTxDetailsInTerminal) return txHash;

        const txResult = await PgTx.confirm(txHash);
        if (txResult?.err) {
          throw new Error(`${Emoji.CROSSMARK} Test failed: ${txResult.err}`);
        }

        PgTerminal.println(
          `${Emoji.CHECKMARK_BUTTON} ${PgTerminal.success(`Test passed.`)}`
        );
      } catch (e: any) {
        if (e.message) {
          const ERRORS = [
            ["unable to infer src variant", "Enum variant not found"],
            [
              "program.methods[txVals.name] is not a function",
              "Test component is outdated",
            ],
          ];

          for (const [before, after] of ERRORS) {
            if (e.message === before) throw new Error(after);
          }
        }

        throw e;
      }
    });

    if (showLogTxHash) {
      await PgCommon.sleep(
        PgConnection.current.rpcEndpoint.startsWith("https") ? 1500 : 200
      );
      await PgCommand.solana.execute("confirm", showLogTxHash, "-v");
    }
  };

  const wallet = useWallet();

  return (
    <InstructionProvider
      instruction={instruction}
      setInstruction={setInstruction}
    >
      <Interaction name={instruction.name}>
        <div className="flex flex-col gap-4">
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
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <AsyncButton
            onClick={handleTest}
            onError={reportButtonFailure("run the test")}
            disabled={!wallet || disabled}
          >
            Test
          </AsyncButton>

          {(instruction.values.accounts.length > 0 ||
            instruction.values.args.length > 0) && (
            <>
              <Button variant="outline" onClick={fillRandom}>
                Fill
              </Button>
              <Button variant="outline" onClick={reset}>
                Reset
              </Button>
            </>
          )}
        </div>
      </Interaction>
    </InstructionProvider>
  );
};

export default Instruction;
