import { FC, useMemo, useRef, useState } from "react";

import InputLabel from "../InputLabel";
import InstructionInput from "./InstructionInput";
import SearchBar, {
  SearchBarDropdownProps,
  SearchBarProps,
} from "../../../../../components/SearchBar";
import { Edit, Plus, Trash } from "../../../../../components/Icons";
import { Button } from "@/shared/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/shared/ui/tooltip";
import {
  IdlType,
  PgProgramInteraction,
  Seed as SeedType,
} from "../../../../../utils/program-interaction";
import { useInstruction } from "./InstructionProvider";
import { useKeybind } from "../../../../../hooks";

type FromSeedProps = {
  name: string;
} & SearchBarDropdownProps;

const FromSeed = ({ name, search }: FromSeedProps) => {
  const { values } = useInstruction().instruction;

  const [seeds, setSeeds] = useState<
    Array<
      | ({ state: "selecting" } & Partial<SeedType>)
      | ({ state: "selected" } & SeedType)
    >
  >(() => {
    // Restore if seeds are already set
    const acc = values.accounts.find((acc) => acc.name === name);
    if (acc && acc.generator.type === "From seed") {
      return acc.generator.seeds.map((seed) => ({
        state: "selected",
        ...seed,
      }));
    }
    return [{ state: "selecting" }];
  });

  // Get whether the seeds are set initially in order to decide whether to
  // show seed input dropdowns
  const [isDefault, initialSeedsLength] = useMemo(
    () => [seeds.at(0)?.state === "selecting", seeds.length],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const showSelectedSeedDropdown = useMemo(
    () => isDefault || initialSeedsLength !== seeds.length,
    [isDefault, initialSeedsLength, seeds.length]
  );

  // Default to instruction program ID but create a new object in order to
  // avoid accidentally updating the instruction program ID
  const programId = useRef({ ...values.programId });

  const generate = () => {
    try {
      const selectedSeeds = seeds.filter(
        (seed) => seed.state === "selected"
      ) as SeedType[];
      search({
        label: "Seed label",
        value: PgProgramInteraction.generateProgramAddressFromSeeds(
          selectedSeeds,
          PgProgramInteraction.generateValue(
            programId.current.generator,
            values
          ),
          values
        ).toBase58(),
        data: {
          seeds: selectedSeeds,
          programId: programId.current,
        },
      });
    } catch (e: any) {
      console.log("Failed to generate address from seeds:", e.message);
    }
  };
  useKeybind("Enter", () => {
    if (document.activeElement?.nodeName !== "INPUT") generate();
  });

  return (
    <div className="flex flex-col gap-4 p-2">
      <div className="flex flex-col gap-4">
        {seeds.map((seed, index) => (
          <div key={index}>
            <div className="mb-1 flex w-full items-center justify-between">
              <InputLabel
                name={`seed(${index + 1})`}
                type={seed.state === "selected" ? seed.type.toString() : ""}
              />

              <div className="flex">
                {seed.state === "selected" && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        onClick={() => {
                          setSeeds((seeds) =>
                            seeds.map((seed, i) => {
                              return i === index
                                ? { ...seed, state: "selecting" }
                                : seed;
                            })
                          );
                        }}
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Edit seed"
                      >
                        <Edit />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Edit seed</TooltipContent>
                  </Tooltip>
                )}
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => {
                        setSeeds((seeds) =>
                          seeds.filter((_, i) => i !== index)
                        );
                      }}
                      variant="ghost"
                      size="icon-sm"
                      className="hover:text-destructive"
                      aria-label="Delete seed"
                    >
                      <Trash />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Delete seed</TooltipContent>
                </Tooltip>
              </div>
            </div>

            {seed.state === "selecting" ? (
              <SeedSearchBar
                select={(value) =>
                  setSeeds((seeds) => {
                    return seeds.map((seed, i) => {
                      if (i === index) {
                        return {
                          state: "selected",
                          type: value as IdlType,
                          generator: { type: "Custom", value: "" },
                        };
                      }
                      return seed;
                    });
                  })
                }
              />
            ) : (
              <SelectedSeed
                index={index}
                seed={seed}
                searchBarProps={{ showSearchOnMount: showSelectedSeedDropdown }}
              />
            )}
          </div>
        ))}
      </div>

      <InstructionInput
        type="publicKey"
        prefix="seed"
        name="program"
        updateInstruction={({ updateGenerator }) => {
          updateGenerator(programId.current);
        }}
        searchBarProps={{ items: getProgramIdItems() }}
        {...values.programId}
      />

      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          onClick={() => {
            setSeeds((seeds) => [...seeds, { state: "selecting" }]);
          }}
        >
          <Plus data-icon="inline-start" />
          Add Seed
        </Button>

        <Button onClick={generate}>Generate</Button>
      </div>
    </div>
  );
};

type SeedSearchBarProps = {
  select: (value: string) => void;
};

const SeedSearchBar: FC<React.PropsWithChildren<SeedSearchBarProps>> = ({
  select,
}) => {
  const [value, setValue] = useState("");
  return (
    <SearchBar
      value={value}
      onChange={(ev) => setValue(ev.target.value)}
      items={[
        "string",
        "publicKey",
        "bytes",
        { label: "uint", items: ["u8", "u16", "u32", "u64", "u128"] },
        { label: "int", items: ["i8", "i16", "i32", "i64", "i128"] },
      ]}
      onSearch={({ item }) => select(item.label)}
      showSearchOnMount
      placeholder="Select seed"
    />
  );
};

type SelectedSeedProps = {
  seed: SeedType;
  index: number;
  searchBarProps: Partial<SearchBarProps>;
};

const SelectedSeed: FC<React.PropsWithChildren<SelectedSeedProps>> = ({
  seed,
  index,
  searchBarProps,
}) => (
  <div>
    <InstructionInput
      prefix="seed"
      name={index.toString()}
      updateInstruction={({ updateGenerator }) => updateGenerator(seed)}
      searchBarProps={searchBarProps}
      noLabel
      {...seed}
    />
  </div>
);

const getProgramIdItems = (): NonNullable<SearchBarProps["items"]> => [
  { label: "Custom", value: { current: true } },
  ...PgProgramInteraction.getPrograms().map((program, i) => ({
    label: i === 0 ? "Current program" : program.name,
    value: program.programId,
  })),
];

export default FromSeed;
