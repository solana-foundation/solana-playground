import styled from "styled-components";

/**
 * The collapse-handle arrow shared by the left and right Flow panels.
 * Points right by default; `$flip` rotates it to point left.
 */
const Chevron = styled.svg.attrs({
  viewBox: "0 0 8 10",
  width: "6",
  height: "8",
  "aria-hidden": true,
  children: (
    <path
      d="M2 1L6 5L2 9"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  ),
})<{ $flip: boolean }>`
  flex-shrink: 0;
  transform: rotate(${({ $flip }) => ($flip ? "180deg" : "0deg")});
`;

export default Chevron;
