import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

import { ARTIFACT, locatePullRequest } from "./locate-pr.mjs";

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

// [workflow, the `uses:` of the step that names the artifact]; a rename in one file alone leaves every pull request without a report
const ARTIFACT_STEPS = [
  ["reusable-client-v2-build.yml", "actions/upload-artifact"],
  ["bundle-info-comment.yml", "actions/download-artifact"],
];

for (const [workflow, action] of ARTIFACT_STEPS) {
  test(`${workflow} names the artifact ARTIFACT in its ${action} step`, async () => {
    const source = await fs.readFile(
      new URL(`../../../../.github/workflows/${workflow}`, import.meta.url),
      "utf8"
    );
    const step = source.match(
      new RegExp(`uses: ${action}@.*\\n\\s+with:\\n\\s+name: (\\S+)`)
    );
    assert.equal(step?.[1], ARTIFACT);
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
