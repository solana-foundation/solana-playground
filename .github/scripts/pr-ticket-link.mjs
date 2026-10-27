// Fails a pull request whose description links no Linear ticket.
// Run by .github/workflows/pr-ticket-link.yml; the logic is in ticket-link.mjs.
//
// It reads the event payload, not the API: a run started by `edited` or
// `labeled` carries the body and labels as they are after that change.
import { appendFileSync, readFileSync } from "node:fs";

import {
  checkTicketLink,
  errorAnnotation,
  failureMessage,
} from "./ticket-link.mjs";

const TITLE = "No Linear ticket link";

const event = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"))
  : {};
const pr = event.pull_request;

if (!pr) {
  console.log(
    errorAnnotation(TITLE, "Not a pull_request event: nothing to check."),
  );
  process.exitCode = 1;
} else {
  const result = checkTicketLink({
    body: pr.body,
    author: pr.user.login,
    labels: pr.labels.map((label) => label.name),
  });

  if (result.ok) {
    console.log(`Ticket link check passed: ${result.reason}.`);
  } else {
    const message = failureMessage(result.reason, event.repository);
    console.log(errorAnnotation(TITLE, message));
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${message}\n`);
    }
    process.exitCode = 1;
  }
}
