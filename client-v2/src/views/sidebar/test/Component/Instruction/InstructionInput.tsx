import { FC, useEffect, useMemo, useRef, useState } from "react";

import { createLogger } from "@/shared/lib/logger";
import { reportButtonFailure } from "@/shared/lib/report-button-failure";
import { CopyButton } from "@/shared/ui/copy-button";

import SearchBar, {
  SearchBarItem,
  SearchBarProps,
} from "../../../../../components/SearchBar";
import { PgCommon, PgWallet, PgWeb3 } from "../../../../../utils";
import {
  GeneratableInstruction,
  Idl,
  IdlType,
  InstructionValueGenerator,
  PgProgramInteraction,
} from "../../../../../utils/program-interaction";
import { useIdl } from "../IdlProvider";
import Label from "../InputLabel";
import FromSeed from "./FromSeed";
import { hasInstructionErrors } from "./instruction-errors";
import { useInstruction } from "./InstructionProvider";

const log = createLogger("test:instruction-input");

type InstructionValues = GeneratableInstruction["values"];
type InstructionInputAccount = InstructionValues["accounts"][number];
type InstructionInputArg = InstructionValues["args"][number];

type InstructionInputProps = {
  prefix: "accounts" | "args" | "seed";
  updateInstruction: (props: {
    updateGenerator: (
      data: Pick<InstructionInputArg, "generator" | "error">
    ) => void;
    updateRefs: (
      data: Omit<InstructionInputArg, "type">,
      refGeneratorType: Extract<
        InstructionValueGenerator["type"],
        "Accounts" | "Arguments"
      >
    ) => void;
    checkErrors: () => boolean;
  }) => void;
  noLabel?: boolean;
  searchBarProps?: Omit<SearchBarProps, "value">;
} & InstructionInputArg &
  Partial<InstructionInputAccount>;

const InstructionInput: FC<React.PropsWithChildren<InstructionInputProps>> = ({
  prefix,
  updateInstruction,
  name,
  type,
  generator,
  searchBarProps,
  noLabel,
  ...accountProps
}) => {
  const { instruction, setInstruction } = useInstruction();
  const { idl } = useIdl();

  const { name: typeName, parse } = useMemo(
    () => PgProgramInteraction.getIdlType(type, idl),
    [type, idl]
  );
  const initialValue = useMemo(
    () => generateValueOrDefault(generator, instruction.values),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const initialError = useMemo(() => {
    // Don't show errors when the initial input is empty
    if (!initialValue) return false;

    try {
      parse(initialValue);
      return false;
    } catch {
      return true;
    }
  }, [initialValue, parse]);

  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState(initialError);
  const [selectedItems, setSelectedItems] = useState<SearchBarItem[]>([]);

  // Handle syncing with transaction context without re-render
  const lastValue = useRef({ value, error, selectedItems });
  useEffect(() => {
    const newValue = { value, error, selectedItems };
    if (PgCommon.isEqual(newValue, lastValue.current)) return;
    lastValue.current = newValue;

    setInstruction((current) => {
      updateInstruction({
        updateGenerator: (data) => {
          const nextGenerator = PgProgramInteraction.createGenerator(
            selectedItems,
            value
          );
          // Only update the generator if there is a generator otherwise the
          // existing generator can be overridden
          if (nextGenerator) data.generator = nextGenerator;
          data.error = error;
        },
        updateRefs: (data, refGeneratorType) => {
          if (!value) return;

          for (const key of ["accounts", "args"] as const) {
            // Default ref
            for (const instructionValue of current.values[key]) {
              if (
                instructionValue.generator.type === refGeneratorType &&
                instructionValue.generator.name === data.name
              ) {
                const inputEl = document.getElementById(
                  current.name + key + instructionValue.name
                ) as HTMLInputElement;
                PgCommon.changeInputValue(inputEl, value);
              }

              // From seed
              if (
                instructionValue.generator.type === "From seed" &&
                [
                  ...instructionValue.generator.seeds,
                  instructionValue.generator.programId,
                ].some(
                  ({ generator: dependency }) =>
                    dependency.type === refGeneratorType &&
                    dependency.name === data.name
                )
              ) {
                const inputEl = document.getElementById(
                  current.name + key + instructionValue.name
                ) as HTMLInputElement;
                const seedValue = generateValueOrDefault(
                  instructionValue.generator,
                  current.values
                );
                PgCommon.changeInputValue(inputEl, seedValue);
              }
            }
          }
        },
        checkErrors: () => hasInstructionErrors(current.values),
      });

      return current;
    });
  }, [value, error, selectedItems, updateInstruction, setInstruction]);

  return (
    <div className="flex flex-col">
      {!noLabel && (
        <div className="flex">
          <Label name={name} type={typeName} {...accountProps} />
        </div>
      )}

      <SearchBar
        id={instruction.name + prefix + name}
        value={value}
        onChange={(ev) => setValue(ev.target.value)}
        error={error}
        setError={setError}
        setSelectedItems={setSelectedItems}
        restoreIfNotSelected
        labelToSelectOnPaste="Custom"
        // Random is one press beside the value, not a menu of one
        inlineItem={{ label: "Random" }}
        placeholder={
          typeName === "publicKey"
            ? "Paste an address or pick one"
            : `Enter a ${typeName} value`
        }
        // Copy sits in the field with the value it copies, not loose
        // beside it
        endAddon={
          value ? (
            <CopyButton value={value} onError={reportButtonFailure("copy")} />
          ) : undefined
        }
        {...getSearchBarProps(
          name,
          type,
          generator,
          accountProps,
          instruction,
          idl
        )}
        {...searchBarProps}
      />
    </div>
  );
};

const getSearchBarProps = (
  name: string,
  type: IdlType,
  generator: InstructionValueGenerator & { name?: string; value?: string },
  accountProps: Partial<Pick<InstructionInputAccount, "isMut" | "isSigner">>,
  instruction: GeneratableInstruction,
  idl: Idl
) => {
  const customizable = PgProgramInteraction.getIdlType(type, idl);
  const searchBarProps: Omit<SearchBarProps, "value"> & {
    noCustomOption?: boolean;
  } = {};

  // Items
  searchBarProps.items = [
    { label: "Random", value: customizable.generateRandom },
  ];

  // Generate values via `generateValueOrDefault` method and push to items.
  const pushGeneratorItem = (
    option:
      | (Pick<Exclude<InstructionValueGenerator, { name: string }>, "type"> & {
          names?: never;
        })
      | (Pick<Extract<InstructionValueGenerator, { name: string }>, "type"> & {
          names: string[];
        })
  ) => {
    if (!searchBarProps.items) return;

    if (!option.names) {
      searchBarProps.items.push({
        label: option.type,
        value: generateValueOrDefault(
          option as InstructionValueGenerator,
          instruction.values
        ),
      });
    } else if (option.names.length) {
      searchBarProps.items.push({
        label: option.type,
        items: option.names.map((optionName) => ({
          label: optionName,
          value: generateValueOrDefault(
            { ...option, name: optionName },
            instruction.values
          ),
        })),
      });
    }
  };

  if (customizable.name === "bool") {
    searchBarProps.items.push("false", "true");
    searchBarProps.noCustomOption = true;
  } else if (customizable.name === "publicKey") {
    // Handle "Random" for "publicKey" differently in order to be able to
    // sign the transaction later with the generated key
    searchBarProps.items[0] = {
      label: "Random",
      data: Array.from(PgWeb3.Keypair.generate().secretKey),
      get value() {
        return PgWeb3.Keypair.fromSecretKey(
          Uint8Array.from((this as { data: number[] }).data)
        ).publicKey.toBase58();
      },
    };

    // Wallet(s)
    if (PgWallet.current) {
      pushGeneratorItem({ type: "Current wallet" });

      const wallets = PgWallet.getConnectedWallets();
      if (wallets.length > 1) {
        pushGeneratorItem({
          type: "All wallets",
          names: wallets.map((w) => w.name),
        });
      }
    }

    // From seed
    searchBarProps.items.push({
      label: "From seed",
      DropdownComponent: (props) => <FromSeed {...props} name={name} />,
      closeButton: true,
    });

    if (PgWallet.current && !accountProps.isSigner) {
      searchBarProps.items.push(
        {
          label: "Token accounts",
          items: async () => {
            const accounts = await PgProgramInteraction.getTokenAccounts();

            return accounts.map(({ address, mint, amount }) => ({
              label: address,
              value: address,
              matches: [mint, amount].filter(Boolean),
            }));
          },
        },
        {
          label: "Mint accounts",
          items: async () => {
            const accounts = await PgProgramInteraction.getMintAccounts();

            return accounts.map((address) => ({
              label: address,
              value: address,
            }));
          },
        }
      );
    }

    // Programs
    if (!(accountProps.isMut || accountProps.isSigner)) {
      pushGeneratorItem({
        type: "All programs",
        names: PgProgramInteraction.getPrograms().map((p) => p.name),
      });
    }
  } else {
    // Handle enum
    const definedType = idl.types?.find(
      (t) => t.name === customizable.name
    )?.type;
    if (definedType?.kind === "enum") {
      const enumItems = definedType.variants.map((variant) => {
        const camelCaseName = PgCommon.toCamelCase(variant.name);

        // Unit
        if (!variant.fields?.length) return camelCaseName;

        const lowerCaseName = camelCaseName.toLowerCase();
        const createValue = (value: string, defaultValue: string) => {
          if (value.toLowerCase().includes(lowerCaseName)) return value;
          return defaultValue;
        };
        const matches = (value: string) => {
          if (!value) return true;

          const lowerCaseValue = value.toLowerCase();
          if (lowerCaseName.includes(lowerCaseValue)) return true;
          return new RegExp(lowerCaseName).test(lowerCaseValue);
        };

        // Named
        if ((variant.fields[0] as { name?: string }).name) {
          return {
            label: camelCaseName,
            value: (v: string) => createValue(v, `{ ${camelCaseName}: {...} }`),
            matches,
          };
        }

        // Tuple
        return {
          label: camelCaseName,
          value: (v: string) => createValue(v, `{ ${camelCaseName}: [...] }`),
          matches,
        };
      });
      searchBarProps.items.push(...enumItems);
      searchBarProps.noCustomOption = true;
    }
  }

  // Add argument refs
  pushGeneratorItem({
    type: "Arguments",
    names: instruction.values.args
      .filter((arg) => arg.name !== name && PgCommon.isEqual(arg.type, type))
      .map((arg) => arg.name),
  });

  // Add account refs
  pushGeneratorItem({
    type: "Accounts",
    names: instruction.values.accounts
      .filter((acc) => acc.name !== name && type === "publicKey")
      .map((acc) => acc.name),
  });

  // Add custom value after type overrides to get `noCustomOption`
  if (!searchBarProps.noCustomOption) {
    searchBarProps.items.unshift({
      label: "Custom",
      value: { current: true },
      onlyShowIfValid: true,
    });
  }

  // Initial items to select
  searchBarProps.initialSelectedItems = searchBarProps.noCustomOption
    ? generator.type === "Custom"
      ? generator.value === ""
        ? []
        : generator.value
      : generator.type
    : generator.name
    ? [generator.type, generator.name]
    : generator.type === "Random"
    ? { label: generator.type, data: generator.data }
    : generator.type;

  // Validator
  searchBarProps.validator = (...args) => {
    try {
      customizable.parse(...args);
      return true;
    } catch {
      return false;
    }
  };

  return searchBarProps;
};

/** Generate the value or default to an empty string in the case of an error. */
const generateValueOrDefault = (
  generator: InstructionValueGenerator,
  values: InstructionValues
) => {
  try {
    return PgProgramInteraction.generateValue(generator, values);
  } catch (e: any) {
    log.warn(`Failed to generate: ${e.message}`);
    return "";
  }
};

export default InstructionInput;
