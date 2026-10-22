import { FC } from "react";

import { Tag } from "@/shared/ui/tag";

interface InputLabelProps {
  name: string;
  type: string;
  isMut?: boolean;
  isSigner?: boolean;
}

/** An input's name in mono, then its type and modifiers as tags */
const InputLabel: FC<React.PropsWithChildren<InputLabelProps>> = ({
  name,
  type,
  isMut,
  isSigner,
}) => (
  <div className="mb-1 flex flex-wrap items-center gap-2">
    <span className="font-mono text-xs text-muted-foreground">{name}</span>
    {type && (
      <Tag className="font-mono tracking-normal normal-case">{type}</Tag>
    )}
    {isMut && <Tag variant="warning">mut</Tag>}
    {isSigner && <Tag variant="success">signer</Tag>}
  </div>
);

export default InputLabel;
