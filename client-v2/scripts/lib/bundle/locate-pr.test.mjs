import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import {
  ARTIFACT,
  locatePullRequest,
  OUTPUTS,
  REPORT_FILE,
} from "./locate-pr.mjs";

const REPOSITORY = "solana-foundation/solana-playground";

const RUN = {
  id: 42,
  head_sha: "abc123",
  head_branch: "feat/thing",
  head_repository: { full_name: REPOSITORY },
};

const pullRequest = ({
  number = 77,
  state = "open",
  sha = "abc123",
  ref = "feat/thing",
  repo = REPOSITORY,
} = {}) => ({
  number,
  state,
  head: { sha, ref, repo: { full_name: repo } },
});

const locate = async ({
  artifacts = [{ name: ARTIFACT }],
  prs = [pullRequest()],
} = {}) => {
  const outputs = {};
  const warnings = [];
  await locatePullRequest({
    context: {
      payload: { workflow_run: RUN },
      repo: { owner: "solana-foundation", repo: "solana-playground" },
    },
    // No `info`: a skip logged below warning level throws here
    core: {
      warning: (message) => warnings.push(message),
      setOutput: (name, value) => {
        outputs[name] = value;
      },
    },
    github: {
      rest: {
        actions: {
          listWorkflowRunArtifacts: async () => ({ data: { artifacts } }),
        },
        repos: {
          listPullRequestsAssociatedWithCommit: async () => ({ data: prs }),
        },
      },
    },
  });
  return { outputs, warnings };
};

test("the module imports nothing local, since the comment workflow checks it out alone", async () => {
  const source = await fs.readFile(
    new URL("./locate-pr.mjs", import.meta.url),
    "utf8"
  );
  assert.doesNotMatch(source, /(?:from|import)\s*\(?\s*["']\.{1,2}\//);
});

test("a run without the report artifact names the pull request and warns", async () => {
  const { outputs, warnings } = await locate({
    artifacts: [{ name: "other" }],
  });
  assert.deepEqual(outputs, { pr: "77", has_report: "false" });
  assert.ok(warnings[0].startsWith(`No ${ARTIFACT} artifact on run 42`));
});

const readText = (relative) =>
  fs.readFile(new URL(relative, import.meta.url), "utf8");
const workflow = (name) => readText(`../../../../.github/workflows/${name}`);

/** The value of `key` under the first step of `source` that uses `action`, whatever the order of its keys */
const stepValue = (source, action, key) =>
  source
    .split(/\n(?=\s+- )/)
    .find((step) => step.includes(`uses: ${action}@`))
    ?.match(new RegExp(`\\n\\s+${key}: (.+)`))?.[1];

// [contract, () => [actual, expected]]; a rename on one side alone makes the comment workflow skip or fail outside the PR's checks
const CONTRACT = [
  [
    "reusable-client-v2-build.yml uploads the artifact ARTIFACT",
    async () => [
      stepValue(
        await workflow("reusable-client-v2-build.yml"),
        "actions/upload-artifact",
        "name"
      ),
      ARTIFACT,
    ],
  ],
  [
    "bundle-info-comment.yml downloads the artifact ARTIFACT",
    async () => [
      stepValue(
        await workflow("bundle-info-comment.yml"),
        "actions/download-artifact",
        "name"
      ),
      ARTIFACT,
    ],
  ],
  [
    "bundle-info-report.sh writes REPORT_FILE under build/",
    async () => [
      (await readText("../../bundle-info-report.sh")).match(
        /^report="(.+)"$/m
      )?.[1],
      `build/${REPORT_FILE}`,
    ],
  ],
  [
    "reusable-client-v2-build.yml uploads REPORT_FILE from build/",
    async () => [
      stepValue(
        await workflow("reusable-client-v2-build.yml"),
        "actions/upload-artifact",
        "path"
      ),
      `client-v2/build/${REPORT_FILE}`,
    ],
  ],
  [
    "bundle-info-comment.yml posts REPORT_FILE from where it downloads the artifact",
    async () => {
      const source = await workflow("bundle-info-comment.yml");
      return [
        stepValue(source, "marocchino/sticky-pull-request-comment", "path"),
        `${stepValue(
          source,
          "actions/download-artifact",
          "path"
        )}/${REPORT_FILE}`,
      ];
    },
  ],
  [
    "bundle-info-comment.yml reads exactly the OUTPUTS locatePullRequest sets",
    async () => [
      [
        ...new Set(
          Array.from(
            (await workflow("bundle-info-comment.yml")).matchAll(
              /steps\.locate\.outputs\.(\w+)/g
            ),
            (match) => match[1]
          )
        ),
      ].sort(),
      Object.values(OUTPUTS).sort(),
    ],
  ],
  [
    "bundle-info-comment.yml runs on the workflow client-v2.yml names",
    async () => [
      (await workflow("bundle-info-comment.yml")).match(
        /workflow_run:\n\s+workflows: \[(.+)\]/
      )?.[1],
      (await workflow("client-v2.yml")).match(/^name: (.+)$/m)?.[1],
    ],
  ],
];

for (const [name, read] of CONTRACT) {
  test(name, async () => {
    const [actual, expected] = await read();
    assert.deepEqual(actual, expected);
  });
}

const SKIPPED = {};

// [case, the pull requests holding the run's head commit, outputs]; a skip warns
const PULL_REQUESTS = [
  [
    "the matching pull request gets the comment past one whose head moved on",
    [pullRequest({ number: 76, sha: "newer" }), pullRequest({ number: 78 })],
    { pr: "78", has_report: "true" },
  ],
  [
    "a closed pull request is skipped",
    [pullRequest({ state: "closed" })],
    SKIPPED,
  ],
  [
    "a stacked branch holding the commit is skipped",
    [pullRequest({ ref: "other-branch" })],
    SKIPPED,
  ],
  [
    "a head in another repository is skipped",
    [pullRequest({ repo: "someone/solana-playground" })],
    SKIPPED,
  ],
];

for (const [name, prs, expected] of PULL_REQUESTS) {
  test(name, async () => {
    const { outputs, warnings } = await locate({ prs });
    assert.deepEqual(outputs, expected);
    assert.deepEqual(
      warnings,
      expected === SKIPPED
        ? [
            "No open pull request has abc123 as its current head; no comment posted.",
          ]
        : []
    );
  });
}
