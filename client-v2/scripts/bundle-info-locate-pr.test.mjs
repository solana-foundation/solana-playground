import assert from "node:assert/strict";
import test from "node:test";

import { locatePullRequest } from "./bundle-info-locate-pr.mjs";

const RUN = {
  id: 42,
  head_sha: "abc123",
  head_branch: "feat/thing",
  head_repository: { full_name: "hoodieshq/solana-playground" },
};

const pullRequest = ({
  state = "open",
  sha = "abc123",
  ref = "feat/thing",
  repo = "hoodieshq/solana-playground",
} = {}) => ({
  number: 77,
  state,
  head: { sha, ref, repo: { full_name: repo } },
});

const locate = async ({
  artifacts = [{ name: "bundle-info-comment" }],
  prs = [pullRequest()],
} = {}) => {
  const outputs = {};
  const infos = [];
  await locatePullRequest({
    context: {
      payload: { workflow_run: RUN },
      repo: { owner: "solana-foundation", repo: "solana-playground" },
    },
    core: {
      info: (message) => infos.push(message),
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
  return { outputs, infos };
};

test("an open pull request whose head is the run's head gets the comment", async () => {
  const { outputs } = await locate();
  assert.deepEqual(outputs, { found: "true", pr: "77" });
});

test("a run without the report artifact is skipped", async () => {
  const { outputs, infos } = await locate({ artifacts: [{ name: "other" }] });
  assert.deepEqual(outputs, {});
  assert.match(infos[0], /No bundle report artifact/);
});

// [case, the one field of the pull request that differs from the run]
const MISMATCHES = [
  ["a closed pull request", { state: "closed" }],
  ["a head that moved past the run", { sha: "newer" }],
  ["a stacked branch holding the commit", { ref: "other-branch" }],
  ["a head in another repository", { repo: "someone/solana-playground" }],
];

for (const [name, fields] of MISMATCHES) {
  test(`${name} is skipped`, async () => {
    const { outputs } = await locate({ prs: [pullRequest(fields)] });
    assert.deepEqual(outputs, {});
  });
}
