// Split only for line length: every piece starts with a space or a sign, so
// the joined path data is unchanged
const GITHUB_MARK_PATH =
  "M8 .2a8 8 0 0 0-2.5 15.6c.4 0 .5-.2.5-.4v-1.4c-2 .4-2.5-.9-2.5-.9" +
  "-.4-.9-.9-1.2-.9-1.2-.7-.5.1-.5.1-.5.8.1 1.2.9 1.2.9.7 1.2 1.9.9" +
  " 2.4.7 0-.5.3-.9.5-1.1-1.8-.2-3.7-.9-3.7-4a3 3 0 0 1 .8-2.1 2.9" +
  " 2.9 0 0 1 .1-2.1s.7-.2 2.2.8a7.6 7.6 0 0 1 4 0c1.5-1 2.2-.8" +
  " 2.2-.8.3.7.3 1.5.1 2.1a3 3 0 0 1 .8 2.1c0 3.1-1.9 3.8-3.7 4" +
  " .3.3.6.8.6 1.5v2.1c0 .2.1.4.5.4A8 8 0 0 0 8 .2Z";

/** GitHub's mark; lucide no longer ships brand icons */
const GithubMark = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 16 16" aria-hidden className={className}>
    <path fill="currentColor" d={GITHUB_MARK_PATH} />
  </svg>
);

export default GithubMark;
