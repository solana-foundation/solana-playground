// Finds the bundle report artifact and the pull request of a completed client-v2 run; .github/workflows/bundle-info-comment.yml runs it through actions/github-script
const ARTIFACT = "bundle-info-comment";

export async function locatePullRequest({ github, context, core }) {
  const run = context.payload.workflow_run;
  const {
    data: { artifacts },
  } = await github.rest.actions.listWorkflowRunArtifacts({
    ...context.repo,
    run_id: run.id,
  });
  if (!artifacts.some((artifact) => artifact.name === ARTIFACT)) {
    return core.info("No bundle report artifact on this run; skipping.");
  }

  const { data: prs } =
    await github.rest.repos.listPullRequestsAssociatedWithCommit({
      ...context.repo,
      commit_sha: run.head_sha,
    });
  // Strict match: the endpoint returns every pull request holding the commit, so a stacked branch or a rerun of a superseded head would otherwise take the comment
  const pr = prs.find(
    (pr) =>
      pr.state === "open" &&
      pr.head.sha === run.head_sha &&
      pr.head.ref === run.head_branch &&
      pr.head.repo?.full_name === run.head_repository?.full_name
  );
  if (!pr) {
    return core.info(
      "No open pull request has this run's head as its current head; skipping."
    );
  }

  core.setOutput("found", "true");
  core.setOutput("pr", String(pr.number));
}
