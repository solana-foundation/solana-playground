import styled, { css } from "styled-components";

import Primary from "./Primary";
import Secondary from "./Secondary";
import { PgTheme } from "../../../utils";

const Main = () => (
  <Wrapper>
    <Primary />
    <Secondary />
  </Wrapper>
);

const Wrapper = styled.div`
  ${({ theme }) => css`
    ${PgTheme.toCss(theme.views.main.default)};
  `}
`;

export default Main;
