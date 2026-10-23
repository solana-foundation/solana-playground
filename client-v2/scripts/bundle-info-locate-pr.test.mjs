import assert from "node:assert/strict";
import test from "node:test";

import { locatePullRequest } from "./bundle-info-locate-pr.mjs";

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
  artifacts = [{ name: "bundle-info-comment" }],
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

test("a run without the report artifact is skipped with a warning", async () => {
  const { outputs, warnings } = await locate({
    artifacts: [{ name: "other" }],
  });
  assert.deepEqual(outputs, {});
  assert.match(warnings[0], /No bundle-info-comment artifact on run 42/);
});

const SKIPPED = {};

// [case, the pull requests holding the run's head commit, outputs]
const PULL_REQUESTS = [
  [
    "the matching pull request gets the comment past one whose head moved on",
    [pullRequest({ number: 76, sha: "newer" }), pullRequest({ number: 78 })],
    { found: "true", pr: "78" },
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
    const { outputs } = await locate({ prs });
    assert.deepEqual(outputs, expected);
  });
}
