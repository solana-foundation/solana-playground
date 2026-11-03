import { FC, useCallback, useEffect, useReducer, useState } from "react";

import InstructionInput from "./InstructionInput";
import InstructionProvider from "./InstructionProvider";
import Interaction from "../Interaction";
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
import { cn } from "@/shared/lib/utils";
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
  const { args, accounts } = instruction.values;
  const hasInputs = args.length > 0 || accounts.length > 0;
  const held = heldBecause({ wallet: !!wallet, filled: !disabled });

  return (
    <InstructionProvider
      instruction={instruction}
      setInstruction={setInstruction}
    >
      <Interaction name={instruction.name} meta={inputsMeta(args, accounts)}>
        <div className="flex flex-col gap-5">
          {args.length > 0 && (
            <Group title="Arguments">
              {args.map((arg) => (
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
            </Group>
          )}

          {accounts.length > 0 && (
            <Group title="Accounts">
              {accounts.map((acc) => (
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
            </Group>
          )}
        </div>

        {/* Test is the card's one action; filling and clearing the fields
            are quiet beside it, and a held Test says what it waits for */}
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-2 gap-y-3",
            hasInputs && "mt-5 border-t border-border pt-4"
          )}
        >
          <AsyncButton
            onClick={handleTest}
            onError={reportButtonFailure("run the test")}
            disabled={!wallet || disabled}
          >
            Test
          </AsyncButton>

          {hasInputs && (
            <>
              <Button variant="ghost" onClick={fillRandom}>
                Fill with Random
              </Button>
              <Button variant="ghost" onClick={reset}>
                Reset
              </Button>
            </>
          )}

          {held && (
            <p className="ml-auto text-caption text-muted-foreground">{held}</p>
          )}
        </div>
      </Interaction>
    </InstructionProvider>
  );
};

/** "1 arg · 2 accounts", or nothing for an instruction that takes none */
const inputsMeta = (args: unknown[], accounts: unknown[]) =>
  [plural(args.length, "arg"), plural(accounts.length, "account")]
    .filter(Boolean)
    .join(" · ") || undefined;

const plural = (n: number, word: string) =>
  n ? `${n} ${word}${n === 1 ? "" : "s"}` : "";

/** Why Test is held, said beside it; nothing once it can run */
const heldBecause = ({
  wallet,
  filled,
}: {
  wallet: boolean;
  filled: boolean;
}) => {
  if (!wallet) return "Connect a wallet to test";
  if (!filled) return "Fill every field to test";
  return null;
};

/** One kind of input under the instruction, named once above its fields */
const Group = ({
  title,
  children,
}: React.PropsWithChildren<{ title: string }>) => (
  <section className="flex flex-col gap-3">
    <h4 className="m-0 text-caption font-medium text-muted-foreground">
      {title}
    </h4>
    {children}
  </section>
);

export default Instruction;
