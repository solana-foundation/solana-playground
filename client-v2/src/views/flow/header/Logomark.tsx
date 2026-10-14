import styled from "styled-components";

import { GRADIENT } from "../tokens";

/** The product's gradient square, at the top of the navigation */
const Logomark = styled.div`
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  border-radius: 6px;
  background: ${GRADIENT};
`;

export default Logomark;
