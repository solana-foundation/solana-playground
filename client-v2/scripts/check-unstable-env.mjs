// Fails a Vercel build with the unstable routes on by default, until a hosted server serves `/unstable`.
// Only vercel.json's buildCommand (scripts/vercel-build.sh) runs it, so a local production build keeps the flag. The comparison matches the `experimental.unstable` default in src/settings/experimental/experimental.ts.
if (process.env.REACT_APP_SERVER_UNSTABLE === "true") {
  console.error(
    "check-unstable-env: REACT_APP_SERVER_UNSTABLE=true points every new " +
      "browser at /unstable, which no hosted server serves. Unset it in the " +
      "Vercel project environment."
  );
  process.exit(1);
}
