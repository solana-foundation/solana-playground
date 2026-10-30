import { FC, useState } from "react";
import { InfoIcon } from "lucide-react";

import { ModalFrame } from "@/widgets/overlays";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { cn } from "@/shared/lib/utils";

interface SelectProgramProps {
  /** Program names to select from */
  programNames: string[];
}

export const SelectProgram: FC<React.PropsWithChildren<SelectProgramProps>> = ({
  programNames,
}) => {
  const [selected, setSelected] = useState<string | null>(null);

  return (
    <ModalFrame
      name="select-program"
      title="Select the program to import"
      buttonProps={{
        text: "Select",
        onSubmit: () => selected,
      }}
    >
      <div className="max-w-[32rem]">
        <Callout variant="info">
          <InfoIcon />
          <CalloutDescription>
            Multiple programs have been found but playground currently supports
            one program per project.
          </CalloutDescription>
        </Callout>

        <div className="mt-4">
          {programNames.map((name) => (
            <div
              key={name}
              className={cn(
                "my-3 cursor-pointer rounded-[12px] border px-4 py-2 font-bold transition-all duration-150 ease-linear hover:text-[var(--text-primary)]",
                name === selected
                  ? "border-primary text-[var(--text-primary)]"
                  : "border-border text-[var(--text-secondary)] hover:border-[var(--text-primary)]"
              )}
              onClick={() => setSelected((s) => (s === name ? null : name))}
            >
              {name}
            </div>
          ))}
        </div>
      </div>
    </ModalFrame>
  );
};
