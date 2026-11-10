import { useRenderOnChange } from "@/hooks";
import type { Setting } from "@/utils";

import BaseCodeSample from "./BaseCodeSample";

/**
 * The code sample in the font the setting holds, redrawn when it changes: the
 * page around it does not re-render on a font pick
 */
const CodeSample = ({
  setting,
}: {
  setting: Pick<Setting<string, string>, "getValue" | "onChange">;
}) => {
  useRenderOnChange(setting.onChange);
  return <BaseCodeSample font={setting.getValue()} />;
};

export default CodeSample;
