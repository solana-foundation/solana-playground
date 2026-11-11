import { ANCHOR_VERSION, SOLANA_VERSION } from "./versions";

export type IdlBuildMethod = "docker" | "local";

export const isIdlBuildMethod = (value: string): value is IdlBuildMethod =>
  value === "docker" || value === "local";

/** A step that runs a shell command; the id is the `step` the copy event sends */
export type CommandStepId =
  | "docker-build"
  | "install-rust"
  | "install-solana"
  | "install-anchor"
  | "anchor-build";

/** Where both methods write the IDL: the project root, since `-o` creates no folder and a fresh export has no `target/idl` */
export const IDL_PATH = "idl.json";

/** Builds the IDL, then prints where it landed; `&&` keeps a failed build from announcing an older `idl.json` */
const buildIdlWith = (anchor: string) =>
  `${anchor} idl build -o ${IDL_PATH} && echo "IDL written to $PWD/${IDL_PATH}"`;

/** Shell lines run together, copied as one */
export interface Command {
  id: CommandStepId;
  lines: string[];
}

/** One tool of the toolchain, named over its own command so a failure names the tool */
export interface Tool {
  name: string;
  command: Command;
}

/**
 * A step of a method. The download and the IDL's upload open and close every
 * method, so the dialog draws them itself; these are the steps between.
 */
export type GuideStep =
  | { kind: "command"; command: Command }
  /** Folded: whoever has the tools skips it. `note` follows the tools */
  | { kind: "install"; title: string; tools: Tool[]; note: string };

const BUILD: GuideStep = {
  kind: "command",
  command: {
    id: "anchor-build",
    lines: [buildIdlWith("anchor")],
  },
};

// TODO: export the features the server enables on each crate, so a program that needs one builds its IDL locally
/** The steps of each method between the download and the upload */
export const STEPS: Record<IdlBuildMethod, GuideStep[]> = {
  docker: [
    {
      kind: "command",
      command: {
        id: "docker-build",
        lines: [
          buildIdlWith(
            `docker run --rm --platform linux/amd64 -v "$PWD":/workdir -w /workdir quay.io/ottersec/anchor:v${ANCHOR_VERSION} anchor`
          ),
        ],
      },
    },
  ],
  local: [
    {
      kind: "install",
      title: "Install Rust, Solana CLI, Anchor",
      note: "Linux needs build-essential, pkg-config, libssl-dev, libudev-dev.",
      tools: [
        {
          name: "Rust",
          command: {
            id: "install-rust",
            lines: [
              "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
              '. "$HOME/.cargo/env"',
            ],
          },
        },
        {
          name: `Solana CLI ${SOLANA_VERSION}`,
          command: {
            id: "install-solana",
            lines: [
              `sh -c "$(curl -sSfL https://release.anza.xyz/v${SOLANA_VERSION}/install)"`,
              'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"',
            ],
          },
        },
        {
          name: `Anchor ${ANCHOR_VERSION}`,
          command: {
            id: "install-anchor",
            lines: [
              `cargo install --git https://github.com/otter-sec/anchor --tag v${ANCHOR_VERSION} avm --locked --force`,
              `avm install ${ANCHOR_VERSION}`,
              `avm use ${ANCHOR_VERSION}`,
            ],
          },
        },
      ],
    },
    BUILD,
  ],
};

if (import.meta.vitest) {
  const { describe, it, expect } = import.meta.vitest;

  describe("features/idl-build-guide/model/steps", () => {
    it.each<[IdlBuildMethod, CommandStepId]>([
      ["docker", "docker-build"],
      ["local", "anchor-build"],
    ])(
      "%s announces idl.json on the build's own line, after `&&`",
      (method, id) => {
        const step = STEPS[method].find(
          (s) => s.kind === "command" && s.command.id === id
        );
        expect(step?.kind === "command" && step.command.lines).toEqual([
          expect.stringMatching(
            /anchor idl build -o idl\.json && echo "IDL written to \$PWD\/idl\.json"$/
          ),
        ]);
      }
    );
  });
}
