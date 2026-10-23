import styled, { css } from "styled-components";

/**
 * The section label above the Files tree: grey, in sentence case and
 * untracked, as the prototype's panel head writes "Files".
 */
const Eyebrow = styled.div`
  ${({ theme }) => css`
    padding: 0.75rem 0.75rem 0.375rem;
    color: ${theme.colors.default.textSecondary};
    font-size: 0.8125rem;
    font-weight: 500;
  `}
`;

export default Eyebrow;
