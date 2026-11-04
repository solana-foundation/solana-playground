import { FC, useId, useMemo } from "react";
import styled, { css } from "styled-components";

import { PgLanguage, PgView } from "../../utils";
import { QuestionMark } from "../Icons";

interface LangIconProps {
  /** File path to decide the language from */
  path: string;
}

/**
 * A language as two letters, the way the TypeScript mark already read:
 * at 16 px the Rust gear blurred into a "®", and a blue, a yellow and an
 * orange mark beside one grey made the tree a row of colours. One face, one
 * weight, one grey; a test file is told by its `.test` in the name.
 *
 * The letters are Stack Sans Text Bold outlined, 5.75 px to the cap and
 * centred on the tile by their ink, not set as SVG text: text would join the
 * row's own (a tab read "RSlib.rs") and wait on the web font.
 * TODO(design-system): file icons in the kit, then drop this
 */
const MONOGRAMS: Record<string, string> = {
  Rust: "M3.07 5.12H4.26V10.88H3.07ZM3.52 7.87H5.06V8.9H3.52ZM5.06 7.87Q5.45 7.87 5.73 7.79Q6.02 7.71 6.17 7.53Q6.32 7.34 6.32 7.01Q6.32 6.69 6.17 6.5Q6.02 6.32 5.73 6.24Q5.45 6.16 5.06 6.16V5.12Q5.8 5.12 6.37 5.31Q6.93 5.49 7.24 5.9Q7.56 6.31 7.56 7.01Q7.56 7.71 7.24 8.13Q6.93 8.54 6.37 8.72Q5.8 8.9 5.06 8.9ZM3.52 5.12H5.06V6.16H3.52ZM5.12 8.22H6.31L7.6 10.88H6.25ZM9.54 9.04Q9.57 9.31 9.73 9.51Q9.89 9.71 10.14 9.82Q10.39 9.92 10.7 9.92Q11.12 9.92 11.4 9.78Q11.69 9.63 11.69 9.32Q11.69 9.1 11.51 8.97Q11.33 8.84 11.03 8.76Q10.73 8.67 10.38 8.59Q10.02 8.51 9.67 8.39Q9.31 8.27 9.01 8.07Q8.71 7.86 8.53 7.53Q8.35 7.2 8.35 6.69Q8.35 6.19 8.64 5.81Q8.93 5.43 9.45 5.21Q9.96 4.99 10.62 4.99Q11.26 4.99 11.76 5.25Q12.26 5.5 12.55 5.95Q12.84 6.39 12.84 6.95H11.59Q11.56 6.54 11.31 6.31Q11.06 6.08 10.58 6.08Q10.1 6.08 9.84 6.25Q9.59 6.42 9.59 6.69Q9.59 6.93 9.77 7.07Q9.95 7.21 10.25 7.3Q10.55 7.39 10.91 7.47Q11.27 7.55 11.62 7.66Q11.97 7.78 12.27 7.98Q12.57 8.17 12.75 8.5Q12.93 8.82 12.93 9.32Q12.93 10.12 12.33 10.56Q11.73 11.01 10.65 11.01Q9.99 11.01 9.46 10.75Q8.93 10.5 8.62 10.05Q8.31 9.61 8.28 9.04Z",
  TypeScript:
    "M4.81 5.12H6V10.88H4.81ZM3.02 5.12H7.79V6.16H3.02ZM9.59 9.04Q9.62 9.31 9.77 9.51Q9.93 9.71 10.18 9.82Q10.43 9.92 10.74 9.92Q11.16 9.92 11.45 9.78Q11.74 9.63 11.74 9.32Q11.74 9.1 11.56 8.97Q11.38 8.84 11.08 8.76Q10.78 8.67 10.42 8.59Q10.07 8.51 9.71 8.39Q9.36 8.27 9.06 8.07Q8.76 7.86 8.57 7.53Q8.39 7.2 8.39 6.69Q8.39 6.19 8.69 5.81Q8.98 5.43 9.49 5.21Q10 4.99 10.66 4.99Q11.3 4.99 11.8 5.25Q12.3 5.5 12.6 5.95Q12.89 6.39 12.89 6.95H11.64Q11.61 6.54 11.36 6.31Q11.11 6.08 10.62 6.08Q10.14 6.08 9.89 6.25Q9.63 6.42 9.63 6.69Q9.63 6.93 9.82 7.07Q10 7.21 10.3 7.3Q10.6 7.39 10.95 7.47Q11.31 7.55 11.66 7.66Q12.02 7.78 12.32 7.98Q12.62 8.17 12.8 8.5Q12.98 8.82 12.98 9.32Q12.98 10.12 12.38 10.56Q11.78 11.01 10.69 11.01Q10.04 11.01 9.51 10.75Q8.98 10.5 8.67 10.05Q8.35 9.61 8.33 9.04Z",
  JavaScript:
    "M6.37 5.12V9.46Q6.37 10.17 5.97 10.52Q5.57 10.88 4.76 10.88H4.18V9.84H4.76Q4.98 9.84 5.08 9.74Q5.18 9.63 5.18 9.43V5.12ZM8.43 9.04Q8.46 9.31 8.62 9.51Q8.77 9.71 9.02 9.82Q9.27 9.92 9.59 9.92Q10 9.92 10.29 9.78Q10.58 9.63 10.58 9.32Q10.58 9.1 10.4 8.97Q10.22 8.84 9.92 8.76Q9.62 8.67 9.27 8.59Q8.91 8.51 8.55 8.39Q8.2 8.27 7.9 8.07Q7.6 7.86 7.42 7.53Q7.24 7.2 7.24 6.69Q7.24 6.19 7.53 5.81Q7.82 5.43 8.33 5.21Q8.85 4.99 9.5 4.99Q10.14 4.99 10.64 5.25Q11.15 5.5 11.44 5.95Q11.73 6.39 11.73 6.95H10.48Q10.45 6.54 10.2 6.31Q9.95 6.08 9.46 6.08Q8.99 6.08 8.73 6.25Q8.48 6.42 8.48 6.69Q8.48 6.93 8.66 7.07Q8.84 7.21 9.14 7.3Q9.44 7.39 9.79 7.47Q10.15 7.55 10.51 7.66Q10.86 7.78 11.16 7.98Q11.46 8.17 11.64 8.5Q11.82 8.82 11.82 9.32Q11.82 10.12 11.22 10.56Q10.62 11.01 9.54 11.01Q8.88 11.01 8.35 10.75Q7.82 10.5 7.51 10.05Q7.2 9.61 7.17 9.04Z",
  Python:
    "M3.08 5.12H4.27V10.88H3.08ZM3.53 7.95H5.07V8.99H3.53ZM5.07 7.95Q5.46 7.95 5.75 7.88Q6.03 7.81 6.18 7.62Q6.33 7.43 6.33 7.06Q6.33 6.69 6.18 6.49Q6.03 6.3 5.75 6.23Q5.46 6.16 5.07 6.16V5.12Q5.82 5.12 6.38 5.31Q6.94 5.5 7.26 5.93Q7.57 6.35 7.57 7.06Q7.57 7.75 7.26 8.18Q6.94 8.61 6.38 8.8Q5.82 8.99 5.07 8.99ZM3.53 5.12H5.07V6.16H3.53ZM10.07 9.3 8.1 5.12H9.31L10.67 8.09H10.36L11.7 5.12H12.92L10.95 9.3ZM9.91 8.01H11.11V10.88H9.91Z",
  JSON: "M7.57 11.65Q6.9 11.65 6.53 11.4Q6.17 11.15 6.03 10.72Q5.89 10.3 5.89 9.77Q5.89 9.24 5.75 8.84Q5.6 8.44 5.22 8.39V7.61Q5.6 7.55 5.75 7.15Q5.89 6.76 5.89 6.23Q5.89 5.7 6.03 5.28Q6.17 4.85 6.53 4.6Q6.9 4.35 7.57 4.35H7.79V5.01H7.57Q7.26 5.01 7.11 5.17Q6.96 5.32 6.92 5.64Q6.88 5.95 6.88 6.45Q6.88 7.22 6.66 7.59Q6.44 7.95 6.03 8Q6.44 8.05 6.66 8.41Q6.88 8.78 6.88 9.55Q6.88 10.04 6.92 10.36Q6.96 10.68 7.11 10.83Q7.26 10.99 7.57 10.99H7.79V11.65ZM8.21 11.65V10.99H8.43Q8.75 10.99 8.89 10.83Q9.04 10.68 9.08 10.36Q9.12 10.04 9.12 9.55Q9.12 8.78 9.34 8.41Q9.56 8.05 9.97 8Q9.56 7.95 9.34 7.59Q9.12 7.22 9.12 6.45Q9.12 5.95 9.08 5.64Q9.04 5.32 8.89 5.17Q8.75 5.01 8.43 5.01H8.21V4.35H8.43Q9.11 4.35 9.47 4.6Q9.83 4.85 9.97 5.28Q10.11 5.7 10.11 6.23Q10.11 6.76 10.25 7.15Q10.4 7.55 10.78 7.61V8.39Q10.4 8.44 10.25 8.84Q10.11 9.24 10.11 9.77Q10.11 10.3 9.97 10.72Q9.83 11.15 9.47 11.4Q9.11 11.65 8.43 11.65Z",
};

const LangIcon: FC<React.PropsWithChildren<LangIconProps>> = ({ path }) => {
  // Per icon, not per language: a mask inside a folded folder (display:
  // none) draws nothing, so a shared id would blank every other copy
  const maskId = useId();
  const Icon = useMemo(() => {
    const lang = PgLanguage.getFromPath(path);
    if (!lang) return <QuestionMark />;
    const monogram = MONOGRAMS[lang.name];
    if (!monogram) return PgView.normalizeElement(lang.icon, { path });
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        {/* A filled 12 px tile on the 16 px grid, 2 clear all round, the
            letters cut through it, as JetBrains and Zed draw TS: an outline
            left the letters 4.5 px tall and the mark read as an empty box.
            Cut out, not painted, so a hovered or selected row shows through */}
        <mask id={maskId}>
          <rect x="2" y="2" width="12" height="12" rx="2.5" fill="white" />
          <path d={monogram} fill="black" />
        </mask>
        <rect
          x="2"
          y="2"
          width="12"
          height="12"
          rx="2.5"
          fill="currentColor"
          mask={`url(#${maskId})`}
        />
      </svg>
    );
  }, [path, maskId]);

  return <Wrapper>{Icon}</Wrapper>;
};

const Wrapper = styled.div`
  ${({ theme }) => css`
    width: 1rem;
    height: 1rem;
    color: ${theme.colors.default.textSecondary};

    & > svg,
    & > img {
      width: 100%;
      height: 100%;
    }
  `}
`;

export default LangIcon;
