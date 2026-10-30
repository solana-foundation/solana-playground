import { FC, useState } from "react";

import { cn } from "@/shared/lib/utils";
import Img from "../../../../../components/Img";
import Input from "../../../../../components/Input";
import { ModalFrame } from "@/widgets/overlays";
import {
  Fn,
  Framework as FrameworkType,
  PgExplorer,
  PgFramework,
} from "../../../../../utils";

export const CreateWorkspace = () => {
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [selected, setSelected] = useState<FrameworkName | null>(null);

  const createWorkspace = async () => {
    const { getDefaultFiles, defaultOpenFile } = PgFramework.get(selected!);
    const { files } = await getDefaultFiles();
    await PgExplorer.createWorkspace(name, { files, defaultOpenFile });
  };

  return (
    <ModalFrame
      name="create-workspace"
      buttonProps={{
        text: "Create",
        onSubmit: createWorkspace,
        disabled: !!error || !selected,
      }}
    >
      <div className="flex flex-col justify-center">
        <div>
          <div className="mb-2 text-[0.875rem] font-bold">Project name</div>
          <Input
            autoFocus
            value={name}
            onChange={(ev) => setName(ev.target.value)}
            validator={PgExplorer.isWorkspaceNameValid}
            error={error}
            setError={setError}
            placeholder="my project..."
          />
        </div>

        <div className="mt-4 mb-2">
          <div className="mb-2 text-[0.875rem] font-bold">
            Choose a framework
          </div>
          <div className="flex gap-8">
            {PgFramework.all.map((f) => (
              <Framework
                key={f.name}
                isSelected={selected === f.name}
                select={() =>
                  setSelected((s) => (s === f.name ? null : f.name))
                }
                {...f}
              />
            ))}
          </div>
        </div>
      </div>
    </ModalFrame>
  );
};

interface FrameworkProps extends FrameworkType {
  isSelected: boolean;
  select: Fn;
}

const Framework: FC<React.PropsWithChildren<FrameworkProps>> = ({
  name,
  language,
  icon,
  circleImage,
  isSelected,
  select,
}) => (
  <div
    className={cn(
      "group w-fit rounded-[12px] border p-4 transition-all duration-150 ease-linear hover:cursor-pointer",
      isSelected
        ? "border-primary"
        : "border-border hover:border-[color:var(--text-primary)]"
    )}
    onClick={select}
  >
    <div
      className={cn(
        "flex size-32 items-center [&>img]:w-full",
        circleImage && "[&>img]:rounded-[50%]"
      )}
    >
      <Img src={icon} alt={name} />
    </div>
    <div
      className={cn(
        "mt-3 text-center font-bold group-hover:text-[color:var(--text-primary)]",
        isSelected
          ? "text-[color:var(--text-primary)]"
          : "text-[color:var(--text-secondary)]"
      )}
    >
      {name}({language})
    </div>
  </div>
);
