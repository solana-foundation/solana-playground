import { describe, expect, it } from "vitest";

import { formatBlockTimeWith, hexDump } from "./print-transaction";

describe("commands/solana/print-transaction", () => {
  describe("formatBlockTimeWith", () => {
    it("prints UTC as +00:00", () => {
      expect(formatBlockTimeWith(() => 0)(1795238309)).toBe(
        "2026-11-21T05:18:29+00:00"
      );
    });

    it("prints a zone east of UTC", () => {
      expect(formatBlockTimeWith(() => 330)(1795238309n)).toBe(
        "2026-11-21T10:48:29+05:30"
      );
    });

    it("prints a zone west of UTC", () => {
      expect(formatBlockTimeWith(() => -480)(1795238309)).toBe(
        "2026-11-20T21:18:29-08:00"
      );
    });
  });

  describe("hexDump", () => {
    it("prints rows of 16 bytes with their ASCII", () => {
      const bytes = Array.from({ length: 18 }, (_, i) => 0x41 + i);

      expect(hexDump(bytes)).toBe(
        [
          "Length: 18 (0x12) bytes",
          "0000:   41 42 43 44  45 46 47 48  49 4a 4b 4c  4d 4e 4f 50   ABCDEFGHIJKLMNOP",
          "0010:   51 52                                                QR",
        ].join("\n")
      );
    });
  });
});
