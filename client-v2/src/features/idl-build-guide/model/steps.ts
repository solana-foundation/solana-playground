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

/** Prints where the IDL landed, so the root location is not a guess; silent when the build wrote nothing */
const SHOW_IDL_PATH = `[ -f ${IDL_PATH} ] && echo "IDL written to $PWD/${IDL_PATH}"`;

export type GuideStep =
  | { kind: "download"; title: string }
  | {
      kind: "command";
      id: CommandStepId;
      title: string;
      /** Turns the first `text` in `title` into a link */
      link?: { text: string; href: string };
      note?: string;
      lines: string[];
    }
  /** `title` leads into the Upload IDL link; `note` follows it */
  | { kind: "upload"; title: string; note: string };

const DOWNLOAD: GuideStep = {
  kind: "download",
  title: "Download the project, unzip it, and open a terminal in its folder.",
};

const UPLOAD: GuideStep = {
  kind: "upload",
  title: `Upload ${IDL_PATH} from the project folder on Deploy:`,
  note: "Build the IDL again after you change the program's instructions or accounts.",
};

// TODO: export the features the server enables on each crate, so a program that needs one builds its IDL locally
/** The steps of each method, from the download to the upload */
export const STEPS: Record<IdlBuildMethod, GuideStep[]> = {
  docker: [
    DOWNLOAD,
    {
      kind: "command",
      id: "docker-build",
      title: `Build the IDL in Anchor ${ANCHOR_VERSION}'s Docker image.`,
      link: {
        text: "Docker",
        href: "https://docs.docker.com/get-started/get-docker/",
      },
      lines: [
        `docker run --rm --platform linux/amd64 -v "$PWD":/workdir -w /workdir quay.io/ottersec/anchor:v${ANCHOR_VERSION} anchor idl build -o ${IDL_PATH}`,
        SHOW_IDL_PATH,
      ],
    },
    UPLOAD,
  ],
  local: [
    DOWNLOAD,
    {
      kind: "command",
      id: "install-rust",
      title: "Install Rust.",
      note: "On Linux, install build-essential, pkg-config, libssl-dev, and libudev-dev first.",
      lines: [
        "curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y",
        '. "$HOME/.cargo/env"',
      ],
    },
    {
      kind: "command",
      id: "install-solana",
      title: `Install the Solana CLI ${SOLANA_VERSION}.`,
      lines: [
        `sh -c "$(curl -sSfL https://release.anza.xyz/v${SOLANA_VERSION}/install)"`,
        'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"',
      ],
    },
    {
      kind: "command",
      id: "install-anchor",
      title: `Install Anchor ${ANCHOR_VERSION} through avm.`,
      lines: [
        `cargo install --git https://github.com/otter-sec/anchor --tag v${ANCHOR_VERSION} avm --locked --force`,
        `avm install ${ANCHOR_VERSION}`,
        `avm use ${ANCHOR_VERSION}`,
      ],
    },
    {
      kind: "command",
      id: "anchor-build",
      title: "Build the IDL.",
      lines: [`anchor idl build -o ${IDL_PATH}`, SHOW_IDL_PATH],
    },
    UPLOAD,
  ],
};
