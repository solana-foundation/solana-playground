// vercel.json's ignoreCommand: Vercel skips the build when this exits 0 and
// builds on any other code, so a crash here builds rather than skips. A
// ticket branch's preview was built on every push, and reviewers use the
// integration branch's preview instead, so only those get a deployment.
// Vercel reads this file from the commit it builds, so a branch that does not
// have it yet builds as before, until it is rebased onto it.
const ref = process.env.VERCEL_GIT_COMMIT_REF;
const target = process.env.VERCEL_ENV;

/**
 * Whether `branch` is one whose preview reviewers use. The design polish
 * rounds are integration branches outside `scope/`, one per round, so their
 * whole family matches and a ticket branch named after one does not.
 */
const isIntegrationBranch = (branch) =>
  branch === "master" ||
  /^new-face-polish-\d+$/.test(branch) ||
  branch.startsWith("scope/");

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
