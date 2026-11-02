import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

import {
  checkDefinition,
  formatError,
  slugOf,
} from "@/entities/tutorial/model/definition/check";
import type { Beat, TutorialDefinition } from "@/entities/tutorial";
import hello from "./hello-anchor/tutorial.json";

/**
 * `AUTHORING.md` is handed to an LLM with the schema and nothing else, so its
 * examples are the format as far as the author's agent knows. These tests
 * keep them true: a beat example is a beat of Hello Anchor, the worked
 * example passes the check, and each error it explains is one the check
 * prints for the worked example broken that way.
 */

const AUTHORING = readFileSync(join(__dirname, "AUTHORING.md"), "utf8");

/** The fenced blocks whose info string is `json <tag>`, parsed */
const blocks = (tag: string): unknown[] =>
  [
    ...AUTHORING.matchAll(
      new RegExp("^```json " + tag + "\\n([\\s\\S]*?)^```$", "gm")
    ),
  ].map((m) => JSON.parse(m[1]));

const helloBeats = new Map<string, Beat>(
  (hello as unknown as TutorialDefinition).steps
    .flatMap((s) => s.beats.concat(s.onFail ?? []))
    .map((b) => [b.id, b])
);

/** The worked example's folder, as an author would name it */
const EXAMPLE_SLUG = "echo-anchor";

/** A definition as plain JSON, for breaking one field at a time */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Mutable = any;
type Docs = Record<string, string>;

/** The bullets of the errors section: each quoted error line */
const quotedErrors = (): string[] => {
  const section = AUTHORING.split(/^## /m).find((s) =>
    s.startsWith("Reading the check's errors")
  );
  return [...(section ?? "").matchAll(/^- `([^`]+)`$/gm)].map((m) => m[1]);
};

describe("tutorials/AUTHORING.md", () => {
  it("every beat example is a beat of Hello Anchor", () => {
    const beats = blocks("beat") as Beat[];
    expect(new Set(beats.map((b) => b.kind))).toEqual(
      new Set(["say", "write", "ask", "act"])
    );
    for (const beat of beats) {
      expect(beat, `beat ${beat.id}`).toEqual(helloBeats.get(beat.id));
    }
  });

  it("the worked example is a two-step definition the check accepts", () => {
    const [example, ...more] = blocks("tutorial") as TutorialDefinition[];
    expect(more).toEqual([]);
    expect(example.steps).toHaveLength(2);
    expect(
      checkDefinition(example, new Set(), {
        slug: EXAMPLE_SLUG,
        docs: {},
      }).map(formatError)
    ).toEqual([]);
  });

  /**
   * Each error the instruction explains, made by breaking the worked example
   * the way the line describes: the check must print the quoted line itself,
   * so a reworded message fails here rather than in an author's run
   */
  const BREAKS: Record<string, (d: Mutable) => Docs | void> = {
    "missing reason": (d) => {
      d.steps[0].beats[2].why[2] = null;
    },
    "reason at the right option": (d) => {
      d.steps[0].beats[2].why[0] = "Right, but why?";
    },
    "answer out of range": (d) => {
      d.steps[0].beats[2].answer = 3;
    },
    "block not in the target": (d) => {
      d.steps[0].beats[1].writes.block = "pub struct Other {}";
    },
    "file not in the target": (d) => {
      d.steps[0].beats[0].writes.file = "src/other.rs";
    },
    "instruction no target defines": (d) => {
      d.steps[1].goal.instruction = "shout";
    },
    "next names nothing": (d) => {
      d.finish.next = "nowhere";
    },
    "two beats share an id": (d) => {
      d.steps[1].beats[0].id = "s1.boil";
    },
    "log is not a regular expression": (d) => {
      d.steps[1].goal.log = "(";
    },
    "name and folder disagree": (d) => {
      d.name = "Echo Program";
    },
    "required field missing": (d) => {
      delete d.steps[0].title;
    },
    "unknown field": (d) => {
      d.colour = "red";
    },
    "unknown beat kind": (d) => {
      d.steps[1].beats[0].kind = "shout";
    },
    "call act without call": (d) => {
      delete d.steps[1].beats[1].call;
    },
    "onFail without planned": (d) => {
      d.steps[0].onFail = [{ kind: "say", id: "f1.explain", text: "Why." }];
    },
    "read-only file the step lacks": (d) => {
      d.steps[1].readOnly = ["src/lib.rs", "Anchor.toml"];
    },
    "doc page missing": (d) => {
      d.docs = [
        { title: "Programs", url: "https://solana.com", file: "programs.md" },
      ];
    },
    "doc link not https": (d) => {
      d.docs = [{ title: "IDL", url: "https://solana.com", file: "idl.md" }];
      return { "idl.md": "See [Solana](http://solana.com)." };
    },
    "value outside the list": (d) => {
      d.level = "Expert";
    },
  };

  /** What the check prints for the worked example with one break applied */
  const printed = (name: string): string[] => {
    const [example] = blocks("tutorial");
    const d: Mutable = JSON.parse(JSON.stringify(example));
    const docs = BREAKS[name](d) ?? {};
    return checkDefinition(d, new Set(), { slug: EXAMPLE_SLUG, docs }).map(
      formatError
    );
  };

  it("names the worked example's folder after its name", () => {
    const [example] = blocks("tutorial") as TutorialDefinition[];
    expect(slugOf(example.name)).toBe(EXAMPLE_SLUG);
  });

  it.each(Object.keys(BREAKS))(
    "quotes the line the check prints for: %s",
    (name) => {
      const lines = printed(name);
      expect(lines.length, name).toBeGreaterThan(0);
      expect(quotedErrors()).toEqual(expect.arrayContaining([lines[0]]));
    }
  );

  it("quotes no error the check does not print", () => {
    const all = Object.keys(BREAKS).flatMap(printed);
    for (const line of quotedErrors()) expect(all, line).toContain(line);
  });

  it("explains the missing reason the spec names", () => {
    expect(printed("missing reason")).toEqual([
      "steps[0].beats[2].why[2]: a wrong option needs a reason, found null",
    ]);
  });

  it("tags every json block, so none escapes these tests", () => {
    const fences = AUTHORING.match(/^```json/gm) ?? [];
    expect(fences.length).toBe(
      blocks("beat").length + blocks("tutorial").length
    );
  });
});
