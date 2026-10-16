import styled from "styled-components";

import Button from "../Button";

/**
 * The one decisive action of a view, carrying the brand gradient.
 *
 * Gradient policy: the 135deg brand gradient
 * appears only on the single primary CTA of a view, the progress indicator and
 * the rail's active marker. Everything else stays flat. Black text — the
 * brand's own treatment on gradient fills, and the only color readable across
 * both gradient ends.
 */
const GradientButton = styled(Button)`
  && {
    /* border-box: the gradient's positioning area defaults to the padding
       box, so the base Button's 1px border ring was painted by the
       repeated tile's far end -- a mint stripe on the left edge */
    background: var(--gradient-product) border-box;
    border-color: transparent;
    color: var(--brand-ink);
    font-weight: 700;

    &:hover:not(:disabled) {
      filter: brightness(1.1);
    }
  }
`;

export default GradientButton;
