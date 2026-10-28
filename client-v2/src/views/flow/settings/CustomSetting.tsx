import { FC, useEffect, useRef, useState } from "react";
import { InfoIcon } from "lucide-react";

import Input from "@/components/Input";
import Markdown from "@/components/Markdown";
import { ModalFrame } from "@/widgets/overlays";
import { Callout, CalloutDescription } from "@/shared/ui/callout";
import { Setting } from "@/utils";

interface CustomSettingProps {
  setting: Setting;
}

export const CustomSetting: FC<React.PropsWithChildren<CustomSettingProps>> = ({
  setting,
}) => {
  // TODO: Make the `setting` variable's type have `custom` property
  const { custom } = setting;
  if (!custom) throw new Error(setting.id);

  const [value, setValue] = useState(() => {
    try {
      const value = `${setting.getValue()}`;
      custom.parse(value);
      return value;
    } catch {
      return "";
    }
  });
  const [error, setError] = useState("");

  // Select the full input value on mount
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.setSelectionRange(0, inputRef.current.value.length);
  }, []);

  return (
    <ModalFrame
      name="custom-setting"
      title
      buttonProps={{
        text: "Set",
        onSubmit: () => setting.setValue(custom.parse(value)),
        disabled: !!error,
      }}
    >
      <div className="max-w-[25rem]">
        <div className="mb-2 font-bold">
          {setting.name}
          {custom.type ? ` (${custom.type})` : ""}
        </div>
        <Input
          ref={inputRef}
          autoFocus
          value={value}
          onChange={(ev) => setValue(ev.target.value)}
          validator={custom.parse}
          error={error}
          setError={setError}
          placeholder={custom.placeholder}
        />

        {custom.tip && (
          <Callout variant="info" className="mt-4">
            <InfoIcon />
            <CalloutDescription>
              <Markdown codeFontOnly>{custom.tip}</Markdown>
            </CalloutDescription>
          </Callout>
        )}
      </div>
    </ModalFrame>
  );
};
