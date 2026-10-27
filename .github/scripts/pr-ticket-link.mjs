// Fails a pull request whose description links no Linear ticket.
// Run by .github/workflows/pr-ticket-link.yml; tests: pr-ticket-link.test.mjs.
//
// The template's own placeholder, `issue/HOO-`, has no number and so never
// matches. HTML comments are cut first: the template's guidance shows a
// filled-in example inside one, which would otherwise pass an untouched body.
import { appendFileSync, readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const TICKET_LINK =
  /https:\/\/linear\.app\/solana-fndn\/issue\/HOO-\d+(?![\dA-Za-z])/;
const EXEMPT_LABEL = "no-ticket";
const EXEMPT_AUTHORS = new Set(["dependabot[bot]"]);

export function checkTicketLink({ body, author, labels }) {
  if (EXEMPT_AUTHORS.has(author)) {
    return { ok: true, reason: `skipped: opened by ${author}` };
  }
  if (labels.includes(EXEMPT_LABEL)) {
    return { ok: true, reason: `skipped: labelled \`${EXEMPT_LABEL}\`` };
  }
  const text = (body ?? "").replace(/<!--[\s\S]*?(-->|$)/g, "");
  const link = text.match(TICKET_LINK);
  if (link) return { ok: true, reason: `links ${link[0]}` };
  return { ok: false, reason: "the description has no Linear ticket link" };
}

// The event payload, not the API: a run triggered by `edited` or `labeled`
// carries the body and labels as they are after that change. A re-run reuses
// the original payload, so the fix message asks for an edit, not a re-run.
function main() {
  const { pull_request: pr, repository } = JSON.parse(
    readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"),
  );
  const result = checkTicketLink({
    body: pr.body,
    author: pr.user.login,
    labels: pr.labels.map((label) => label.name),
  });

  if (result.ok) {
    console.log(`Ticket link check passed: ${result.reason}.`);
    return;
  }

  const template = `${repository.html_url}/blob/${repository.default_branch}/.github/pull_request_template.md`;
  const fix = [
    `This pull request fails because ${result.reason}.`,
    "",
    "Fix: edit the description and put the ticket on its first line, in the template's form:",
    "",
    "    Linear: [HOO-123](https://linear.app/solana-fndn/issue/HOO-123)",
    "",
    "Saving the edit re-runs this check; re-running the old job does not, it reads the description as it was.",
    `No ticket because this is an upstream sync or a trivial chore? Add the \`${EXEMPT_LABEL}\` label instead.`,
    `Template: ${template}`,
  ].join("\n");

  console.log(
    `::error title=No Linear ticket link::${fix.replace(/%/g, "%25").replace(/\n/g, "%0A")}`,
  );
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${fix}\n`);
  }
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
