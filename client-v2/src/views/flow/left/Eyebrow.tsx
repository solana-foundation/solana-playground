import styled, { css } from "styled-components";

/**
 * Small-caps section label above the Files tree / Projects list -- the
 * board's "FILES" / "PROJECTS" headers. Shared between `LeftPanel` (the
 * "Files" tab) and `ProjectsTab` so both stay in sync; a plain sibling
 * export rather than a prop on either, to avoid a circular import between
 * the two (`LeftPanel` already imports `ProjectsTab`).
 */
const Eyebrow = styled.div`
  ${({ theme }) => css`
    padding: 0.75rem 0.75rem 0.375rem;
    color: ${theme.colors.default.textSecondary};
    font-size: ${theme.font.other.size.small};
    font-weight: 600;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  `}
`;

export default Eyebrow;
