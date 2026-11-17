import type { FC } from "react";

import { shortKey } from "@/shared/lib/short-key";

import Link from "../../components/Link";
import { useBlockExplorer } from "../../hooks";

interface ExplorerLinkProps {
  txHash: string;
}

export const ExplorerLink: FC<React.PropsWithChildren<ExplorerLinkProps>> = ({
  txHash,
}) => {
  const blockExplorer = useBlockExplorer();

  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground">Transaction sent</span>
      {/* The signature and its arrow stay on one line: the toast is narrow,
        and a shrinking flex item would wrap the arrow under the text */}
      <Link
        href={blockExplorer.getTxUrl(txHash)}
        aria-label={`Open ${shortKey(txHash)} on ${blockExplorer.name}`}
        className="inline-flex shrink-0 items-center gap-1 whitespace-nowrap [&_svg]:ml-0"
      >
        {shortKey(txHash)}
      </Link>
    </div>
  );
};
