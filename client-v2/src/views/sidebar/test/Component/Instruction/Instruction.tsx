import {
  FC,
  ReactNode,
  useCallback,
  useEffect,
  useId,
  useReducer,
  useState,
} from "react";

import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { cn } from "@/shared/lib/utils";
import { AsyncButton } from "@/shared/ui/async-button";
import { Button } from "@/shared/ui/button";
import { useNetworkHold } from "@/widgets/status";

import { useWallet } from "../../../../../hooks";
import { PgCommon } from "../../../../../utils";
import {
  GeneratableInstruction,
  IdlInstruction,
  PgProgramInteraction,
} from "../../.././../../utils/program-interaction";
import { useIdl } from "../IdlProvider";
import Interaction from "../Interaction";
import { hasInstructionErrors } from "./instruction-errors";
import InstructionInput from "./InstructionInput";
import InstructionProvider from "./InstructionProvider";

interface InstructionProps {
  idlInstruction: IdlInstruction;
  /** Sends the instruction; the form stays locked until it settles */
  onCall: (ix: GeneratableInstruction) => Promise<unknown>;
  /**
   * The network, as said inside a sentence, whose SOL the fee payer lacks
   * for one fee; Send waits for it
   */
  solNeededOn?: string;
  /** Send is held from outside, while another call is in flight */
  callBlocked?: boolean;
  /** Who pays the fee, drawn above the actions */
  feePayer?: ReactNode;
  /** Held open from outside; left out, the card folds on its own */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * One instruction as a card: its head counts the inputs, its body groups
 * them under Arguments and Accounts and ends in Send, which says what it
 * waits for
 */
const Instruction: FC<InstructionProps> = ({
  idlInstruction,
  onCall,
  solNeededOn,
  callBlocked,
  feePayer,
  open,
  onOpenChange,
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
  // This is intentionally done in a `useEffect` instead of
  // seeding `disabled`'s `useState` in order to:
  // - Enable the button when `idlInstruction` changes
  // - Avoid flickering of the Send button i.e. the button renders as enabled
  // and switches to disabled state after.
  useEffect(() => {
    if (!idlInstruction.args.length && !idlInstruction.accounts.length) {
      setDisabled(false);
    }
  }, [idlInstruction]);

  // Check the values the instruction was restored with. The inputs report
  // only what the user edits, so a valid form that comes back after a remount
  // would otherwise keep Send off until a field changes.
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
  const { args, accounts } = instruction.values;
  const hasInputs = args.length > 0 || accounts.length > 0;
  const network = useNetworkHold();
  // Another call in flight holds Send on every card with no reason line:
  // the running card's "Sending…" is the only sign. The card's own reasons
  // return once that call settles
  const held = callBlocked
    ? undefined
    : heldBecause({
        network,
        wallet: !!wallet,
        solNeededOn,
        filled: !disabled,
      });

  return (
    <InstructionProvider
      instruction={instruction}
      setInstruction={setInstruction}
    >
      <Interaction
        name={instruction.name}
        meta={inputsMeta(args, accounts)}
        open={open}
        onOpenChange={onOpenChange}
      >
        {/* One gap between the inputs, the fee payer and the row, so a card
            without inputs does not open on an empty band */}
        <div className="flex flex-col gap-4">
          {hasInputs && (
            <fieldset
              disabled={calling}
              className="m-0 flex min-w-0 flex-col gap-5 border-0 p-0"
            >
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
            </fieldset>
          )}

          {feePayer}

          {/* Send is the card's one action; filling and clearing the fields
            are quiet beside it, and a held Send says what it waits for */}
          <div
            className={cn(
              "flex flex-wrap items-center gap-x-2 gap-y-3",
              hasInputs && "mt-1 border-t border-border pt-4"
            )}
          >
            <AsyncButton
              onClick={call}
              onError={reportButtonFailure(`send ${instruction.name}`)}
              disabled={!!held || callBlocked}
              loadingText="Sending…"
            >
              Send
            </AsyncButton>

            {hasInputs && (
              <>
                <Button variant="ghost" onClick={fillRandom} disabled={calling}>
                  Fill with Random
                </Button>
                <Button variant="ghost" onClick={reset} disabled={calling}>
                  Reset
                </Button>
              </>
            )}

            {held && (
              <p className="m-0 ml-auto text-caption text-muted-foreground">
                {held}
              </p>
            )}
          </div>
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

/**
 * Why Send is held, said beside it; nothing once it can run. A network that
 * is down comes first, then the fee before the fields: filling them does not
 * help while it cannot be paid
 */
const heldBecause = ({
  network,
  wallet,
  solNeededOn,
  filled,
}: {
  network: string | undefined;
  wallet: boolean;
  solNeededOn?: string;
  filled: boolean;
}) => {
  if (network) return network;
  if (!wallet) return "Connect a wallet to send";
  if (solNeededOn) return `Add ${solNeededOn} SOL to send`;
  if (!filled) return "Fill every field to send";
  return undefined;
};

/**
 * One kind of input under the instruction, named once above its fields. The
 * name labels a group, not a heading: the card's head is a button, so a
 * heading here would skip a level in the page's outline
 */
const Group = ({
  title,
  children,
}: React.PropsWithChildren<{ title: string }>) => {
  const id = useId();
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <p id={id} className="m-0 text-caption font-medium text-muted-foreground">
        {title}
      </p>
      {children}
    </section>
  );
};

export default Instruction;
