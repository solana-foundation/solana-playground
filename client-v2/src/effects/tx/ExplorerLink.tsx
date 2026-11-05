import type { FC } from "react";

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
    <div className="flex justify-around">
      <Link href={blockExplorer.getTxUrl(txHash)}>{blockExplorer.name}</Link>
    </div>
  );
};
