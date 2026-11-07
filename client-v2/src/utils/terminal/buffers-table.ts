/** The escape character that starts an ANSI style */
const ESC = "\u001b";

/** Matches the SGR styling (`ESC[…m`) solana-cli puts on the table's header */
const ANSI = new RegExp(`${ESC}\\[[0-9;]*m`, "g");

/** `text` without its SGR styling, so its length is the columns it takes */
const stripAnsi = (text: string) => text.replace(ANSI, "");

/** The header solana-cli prints over `solana program show --buffers` */
const HEADER = /^Buffer Address\s+\|\s+Authority\s+\|\s+Balance\s*$/;

/**
 * Splits a row into its three cells. No cell holds " | ": two are base58
 * addresses and the third a balance, so a line that splits otherwise has
 * left the table.
 */
const SEPARATOR = " | ";

const LABELS = ["Buffer Address", "Authority", "Balance"] as const;

/** Width of the label column in the labelled layout, its gap included */
const LABEL_WIDTH = LABELS[0].length + 2;

/**
 * Bold, as solana-cli prints the table's header; not `PgTerminal.bold`, since
 * `terminal.ts` imports this module
 */
const bold = (text: string) => `${ESC}[1m${text}${ESC}[0m`;

/**
 * Fit the table `solana program show --buffers` prints to the terminal.
 *
 * solana-cli pads both addresses to 44 characters, so a row takes 94 columns
 * plus its balance, about 105, and wraps in a console narrower than that,
 * header and rows breaking apart. When a row would wrap, the header is
 * dropped and each buffer is printed as labelled lines; for the whole table
 * the label goes beside its value when the longest value fits beside it, and
 * above it when not. Addresses are never cut: a learner copies one into
 * `solana program close`. A table with no rows reads "No buffers." at any
 * width.
 *
 * solana-cli hands the whole table over as one message (`runSolana` logs its
 * output once), which is what lets the rows be found after the header.
 *
 * @param cols the terminal's width in columns
 * @returns a function from what solana-cli printed to the table laid out for
 * `cols`, or to that output untouched when it is not the buffers table or its
 * rows already fit
 */
export const fitBuffersTableWith =
  (cols: number) =>
  <T>(msg: T): T | string => {
    if (typeof msg !== "string") return msg;

    const lines = msg.split("\n");
    const headerIndex = lines.findIndex((line) => HEADER.test(stripAnsi(line)));
    if (headerIndex === -1) return msg;

    const rowsEnd = lines.findIndex(
      (line, i) => i > headerIndex && line.split(SEPARATOR).length !== 3
    );
    const end = rowsEnd === -1 ? lines.length : rowsEnd;
    const rows = lines
      .slice(headerIndex + 1, end)
      .map((line) => line.split(SEPARATOR).map((cell) => cell.trim()));
    const replaceTable = (body: string) =>
      [...lines.slice(0, headerIndex), body, ...lines.slice(end)].join("\n");

    if (!rows.length) return replaceTable("No buffers.");

    const widest = Math.max(
      ...lines.slice(headerIndex, end).map((line) => stripAnsi(line).length)
    );
    if (widest <= cols) return msg;

    const longest = Math.max(...rows.flat().map((cell) => cell.length));
    const beside = LABEL_WIDTH + longest <= cols;
    const blocks = rows.map((row) =>
      row
        .map((value, i) =>
          beside
            ? bold(LABELS[i].padEnd(LABEL_WIDTH)) + value
            : `${bold(LABELS[i])}\n${value}`
        )
        .join("\n")
    );

    return replaceTable(blocks.join("\n\n"));
  };

if (import.meta.vitest) {
  const { describe, expect, it } = import.meta.vitest;

  const ADDRESS = "7Kp4X1bQmS9yWn3VhJd2RcLzT8uFgE5aNqB6oYiP4sMx";
  const AUTHORITY = "9fHcE2tWq7LmZx4KvR1sNbD8yPjU3gAoT6iQ5eYwC2nB";

  /** What solana-cli prints for `solana program show --buffers`, header bold */
  const table = (rows: string[][]) => {
    const header = `${"Buffer Address".padEnd(44)} | ${"Authority".padEnd(
      44
    )} | Balance`;
    const lines = rows.map(
      ([address, authority, balance]) =>
        `${address.padEnd(44)} | ${authority.padEnd(44)} | ${balance}`
    );
    return ["", `\u001b[1m${header}\u001b[0m`].concat(lines, "").join("\n");
  };

  describe("utils/terminal/buffers-table", () => {
    it("keeps the table when its rows fit the terminal", () => {
      const output = table([[ADDRESS, AUTHORITY, "1.2345 SOL"]]);

      expect(fitBuffersTableWith(200)(output)).toBe(output);
    });

    it("lays each buffer out as labelled lines when the rows would wrap", () => {
      const output = table([
        [ADDRESS, AUTHORITY, "1.2345 SOL"],
        [AUTHORITY, ADDRESS, "0.5 SOL"],
      ]);

      const fitted = stripAnsi(fitBuffersTableWith(100)(output));

      expect(fitted).toBe(
        [
          "",
          `Buffer Address  ${ADDRESS}`,
          `Authority       ${AUTHORITY}`,
          "Balance         1.2345 SOL",
          "",
          `Buffer Address  ${AUTHORITY}`,
          `Authority       ${ADDRESS}`,
          "Balance         0.5 SOL",
          "",
        ].join("\n")
      );
      for (const line of fitted.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(100);
      }
    });

    it("puts each value under its label at a phone's width", () => {
      // Unstyled: the fit must not depend on the header's styling
      const output = stripAnsi(table([[ADDRESS, AUTHORITY, "1.2345 SOL"]]));

      expect(stripAnsi(fitBuffersTableWith(48)(output))).toBe(
        [
          "",
          "Buffer Address",
          ADDRESS,
          "Authority",
          AUTHORITY,
          "Balance",
          "1.2345 SOL",
          "",
        ].join("\n")
      );
    });

    it("keeps the rows when they are exactly as wide as the terminal", () => {
      const output = table([[ADDRESS, AUTHORITY, "1.2345 SOL"]]);
      const width = Math.max(
        ...stripAnsi(output)
          .split("\n")
          .map((l) => l.length)
      );

      expect(fitBuffersTableWith(width)(output)).toBe(output);
      expect(fitBuffersTableWith(width - 1)(output)).not.toBe(output);
    });

    it("puts the labels beside the values only while the longest value fits", () => {
      const output = table([[ADDRESS, AUTHORITY, "1.2345 SOL"]]);
      // "Buffer Address" and its two-space gap, then a 44-character address
      const beside = 16 + ADDRESS.length;

      expect(stripAnsi(fitBuffersTableWith(beside)(output))).toContain(
        `Buffer Address  ${ADDRESS}`
      );
      expect(stripAnsi(fitBuffersTableWith(beside - 1)(output))).toContain(
        `Buffer Address\n${ADDRESS}`
      );
    });

    it("keeps what solana-cli prints before and after the table", () => {
      const output = `Note: before${table([
        [ADDRESS, AUTHORITY, "1 SOL"],
      ])}Note: after`;

      const fitted = stripAnsi(fitBuffersTableWith(100)(output));

      expect(fitted.startsWith("Note: before\n")).toBe(true);
      expect(fitted.endsWith("\nNote: after")).toBe(true);
    });

    it("says there are no buffers at any width", () => {
      for (const cols of [48, 100, 200]) {
        expect(stripAnsi(fitBuffersTableWith(cols)(table([])))).toBe(
          "\nNo buffers.\n"
        );
      }
    });

    it("leaves any other output alone", () => {
      const other = `Program Id: ${ADDRESS} | not a buffer table`;

      expect(fitBuffersTableWith(20)(other)).toBe(other);
      expect(fitBuffersTableWith(20)(42)).toBe(42);
    });
  });
}
