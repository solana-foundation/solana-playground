// Loaded alone: bundle-info-comment.yml sparse-checks out only this file, so it imports nothing local
/** The report artifact's name, as reusable-client-v2-build.yml uploads it and bundle-info-comment.yml downloads it */
export const ARTIFACT = "bundle-info-comment";

/**
 * Sets `pr` to the open pull request whose head is the completed run's head, and `has_report` to whether the run
 * saved the {@link ARTIFACT} artifact; sets nothing and warns when no pull request matches.
 */
export async function locatePullRequest({ github, context, core }) {
  const run = context.payload.workflow_run;
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
    return core.warning(
      `No open pull request has ${run.head_sha} as its current head; no comment posted.`
    );
  }

  const {
    data: { artifacts },
  } = await github.rest.actions.listWorkflowRunArtifacts({
    ...context.repo,
    run_id: run.id,
  });
  const hasReport = artifacts.some((artifact) => artifact.name === ARTIFACT);
  if (!hasReport) {
    core.warning(
      `No ${ARTIFACT} artifact on run ${run.id}: the build job saved no report; the comment says so.`
    );
  }
  core.setOutput("pr", String(pr.number));
  core.setOutput("has_report", String(hasReport));
}
