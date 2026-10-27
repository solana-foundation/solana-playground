// What pr-ticket-link.mjs decides and says; kept apart from it so the tests
// import this and run that, the way the workflow does.
//
// The template's own placeholder, `issue/HOO-`, has no number and so never
// matches. HTML comments are cut first, as GitHub hides them: the template's
// guidance shows a filled-in example inside one, which would otherwise pass an
// untouched body. An unclosed comment hides the rest of the body, on the page
// and here. A comment becomes a space, so `HOO-<!-- -->1` does not join.
const TICKET_LINK = /https:\/\/linear\.app\/solana-fndn\/issue\/HOO-\d+(?!\w)/;
const EXEMPT_LABEL = "no-ticket";
const EXEMPT_AUTHORS = new Set(["dependabot[bot]"]);

export function checkTicketLink({ body, author, labels }) {
  if (EXEMPT_AUTHORS.has(author)) {
    return { ok: true, reason: `skipped: opened by ${author}` };
  }
  if (labels.some((label) => label.toLowerCase() === EXEMPT_LABEL)) {
    return { ok: true, reason: `skipped: labelled \`${EXEMPT_LABEL}\`` };
  }
  const text = (body ?? "").replace(/<!--[\s\S]*?(-->|$)/g, " ");
  const link = text.match(TICKET_LINK);
  if (link) return { ok: true, reason: `links ${link[0]}` };
  return { ok: false, reason: "the description has no Linear ticket link" };
}

// A re-run reuses the event it was started by, so the message asks for an
// edit, which starts a new run with the new description.
export function failureMessage(reason, { html_url, default_branch }) {
  return [
    `This pull request fails because ${reason}.`,
    "",
    "Fix: edit the description and add the ticket link, as the template's first line has it:",
    "",
    "    Linear: [HOO-123](https://linear.app/solana-fndn/issue/HOO-123)",
    "",
    "Links inside HTML comments (<!-- -->) do not count.",
    "Saving the edit re-runs this check; re-running the old job does not, it reads the description as it was.",
    `No ticket because this is an upstream sync or a trivial chore? Add the \`${EXEMPT_LABEL}\` label instead.`,
    `Template: ${html_url}/blob/${default_branch}/.github/pull_request_template.md`,
  ].join("\n");
}

// A workflow command's message escapes %, CR and LF.
export function errorAnnotation(title, message) {
  const escaped = message
    .replace(/%/g, "%25")
    .replace(/\r/g, "%0D")
    .replace(/\n/g, "%0A");
  return `::error title=${title}::${escaped}`;
}
