import { useEffect, useState } from "react";
import styled from "styled-components";

import { PgProjectSync } from "../model/project-sync";

/**
 * Tells the user their other device has newer work.
 *
 * Deliberately a prompt rather than a merge or a silent overwrite: the failure
 * this prevents is "I opened the project on my phone and lost an afternoon on
 * my laptop". Nothing here resolves the conflict on the user's behalf --
 * reloading takes the server's copy, and carrying on and saving takes this
 * one, which is `force` on the next push.
 */
export const SyncBanner = () => {
  const [conflicted, setConflicted] = useState<string | null>(null);

  useEffect(() => {
    const sub = PgProjectSync.onDidConflict(setConflicted);
    return () => sub.dispose();
  }, []);

  if (!conflicted) return null;

  return (
    <Wrapper role="status">
      This project changed on another device. Reload to take that version, or
      keep editing here and save over it.
      <Action onClick={() => window.location.reload()}>Reload</Action>
    </Wrapper>
  );
};

const Wrapper = styled.div`
  ${({ theme }) => `
    padding: 0.5rem 0.75rem;
    background: ${theme.colors.state.warning.bg};
    color: ${theme.colors.state.warning.color};
    font-size: ${theme.font.code.size.small};
    display: flex;
    align-items: center;
    gap: 0.75rem;
  `}
`;

const Action = styled.button`
  ${({ theme }) => `
    color: ${theme.colors.state.warning.color};
    text-decoration: underline;
    cursor: pointer;
    background: none;
    border: none;
    font-size: inherit;
  `}
`;
