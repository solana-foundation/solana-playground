import { FC } from "react";

import { Tag } from "@/shared/ui/tag";

interface InputLabelProps {
  name: string;
  type: string;
  isMut?: boolean;
  isSigner?: boolean;
}

/**
 * An input's name in mono, its type quiet beside it, then what the account
 * may do as neutral tags: `mut` and `signer` are facts about the account,
 * not warnings, so they take no colour.
 */
const InputLabel: FC<React.PropsWithChildren<InputLabelProps>> = ({
  name,
  type,
  isMut,
  isSigner,
}) => (
  <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-1">
    <span className="font-mono text-caption text-foreground">{name}</span>
    {type && (
      <span
        data-slot="input-type"
        className="font-mono text-caption text-muted-foreground"
      >
        {type}
      </span>
    )}
    {isMut && <Tag>mut</Tag>}
    {isSigner && <Tag>signer</Tag>}
  </div>
);

export default InputLabel;
