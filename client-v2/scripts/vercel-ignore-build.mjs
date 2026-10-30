// vercel.json's ignoreCommand: Vercel skips the build when this exits 0 and
// builds on any other code, so a crash here builds rather than skips. Only
// production, a deployment with no Git ref and the integration branches are
// built; a ticket branch is skipped, since reviewers use the integration
// branch's preview and the PR's screenshots.
// Vercel reads this file from the commit it builds, so a branch that does not
// have it yet builds as before, until it is rebased onto it.
const ref = process.env.VERCEL_GIT_COMMIT_REF;
const target = process.env.VERCEL_ENV;

/**
 * Whether `branch` is one whose preview reviewers use: `master`, or a branch
 * under a fixed prefix, `scope/` or `integration/`, so a new integration
 * branch needs only the right name. `new-face-polish-<n>` predates the
 * prefixes; TODO: drop it once `new-face-polish-3` has landed
 * (solana-foundation#72).
 */
const isIntegrationBranch = (branch) =>
  branch === "master" ||
  branch.startsWith("scope/") ||
  branch.startsWith("integration/") ||
  /^new-face-polish-\d+$/.test(branch);

const subject = `${ref || "a deployment with no Git ref"} (${
  target ?? "no VERCEL_ENV"
})`;

// Production is never skipped, whatever its branch is called. Without a ref
// the deployment cannot be classified (a CLI deploy may carry none), so it
// builds too.
if (target === "production" || !ref || isIntegrationBranch(ref)) {
  console.log(`vercel-ignore-build: building ${subject}`);
  process.exit(1);
}

console.log(
  `vercel-ignore-build: skipping ${subject}: not an integration branch`
);
process.exit(0);
