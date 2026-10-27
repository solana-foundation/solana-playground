import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { checkTicketLink, errorAnnotation } from "./ticket-link.mjs";

const template = readFileSync(
  new URL("../pull_request_template.md", import.meta.url),
  "utf8",
);

const pr = (body, { author = "ocatave", labels = [] } = {}) => ({
  body,
  author,
  labels,
});

test("a body with a ticket link passes", () => {
  const body =
    "Linear: [HOO-2314](https://linear.app/solana-fndn/issue/HOO-2314)";
  assert.equal(checkTicketLink(pr(body)).ok, true);
});

test("the long form with the title slug passes", () => {
  const body =
    "https://linear.app/solana-fndn/issue/HOO-2314/fail-a-pull-request";
  assert.equal(checkTicketLink(pr(body)).ok, true);
});

test("the template as it comes fails", () => {
  const result = checkTicketLink(pr(template));
  assert.equal(result.ok, false);
  assert.match(result.reason, /no Linear ticket link/);
});

test("the template with its first line filled in passes", () => {
  const body = template.replace(
    "[HOO-](https://linear.app/solana-fndn/issue/HOO-)",
    "[HOO-1](https://linear.app/solana-fndn/issue/HOO-1)",
  );
  assert.notEqual(body, template);
  assert.equal(checkTicketLink(pr(body)).ok, true);
});

test("the placeholder with no number fails", () => {
  const body = "Linear: [HOO-](https://linear.app/solana-fndn/issue/HOO-)";
  assert.equal(checkTicketLink(pr(body)).ok, false);
  assert.equal(
    checkTicketLink(pr("https://linear.app/solana-fndn/issue/HOO-/slug")).ok,
    false,
  );
});

test("a link between two comments passes", () => {
  const body =
    "<!-- a -->\nhttps://linear.app/solana-fndn/issue/HOO-5\n<!-- b -->";
  assert.equal(checkTicketLink(pr(body)).ok, true);
});

test("an unclosed comment hides what follows, as on the page", () => {
  const link = "https://linear.app/solana-fndn/issue/HOO-5";
  assert.equal(checkTicketLink(pr(`<!-- oops\n${link}`)).ok, false);
  assert.equal(checkTicketLink(pr(`${link}\n<!-- oops`)).ok, true);
});

test("a comment does not join two halves of a number", () => {
  const body = "https://linear.app/solana-fndn/issue/HOO-<!-- -->1";
  assert.equal(checkTicketLink(pr(body)).ok, false);
});

test("a link only inside an HTML comment fails", () => {
  const body =
    "<!-- e.g. https://linear.app/solana-fndn/issue/HOO-123 -->\nsome text";
  assert.equal(checkTicketLink(pr(body)).ok, false);
});

test("an empty or missing body fails", () => {
  assert.equal(checkTicketLink(pr("")).ok, false);
  assert.equal(checkTicketLink(pr(null)).ok, false);
});

test("another workspace or team does not count", () => {
  assert.equal(
    checkTicketLink(pr("https://linear.app/hoodies/issue/HOO-1")).ok,
    false,
  );
  assert.equal(
    checkTicketLink(pr("https://linear.app/solana-fndn/issue/ABC-1")).ok,
    false,
  );
});

test("a digit run that runs into letters does not count", () => {
  for (const tail of ["12abc", "12_x"]) {
    const body = `https://linear.app/solana-fndn/issue/HOO-${tail}`;
    assert.equal(checkTicketLink(pr(body)).ok, false, tail);
  }
});

test("dependabot passes without a link", () => {
  const result = checkTicketLink(pr("", { author: "dependabot[bot]" }));
  assert.equal(result.ok, true);
  assert.match(result.reason, /dependabot/);
});

test("a human whose login merely starts with dependabot is not exempt", () => {
  assert.equal(checkTicketLink(pr("", { author: "dependabot" })).ok, false);
});

test("the no-ticket label matches in any case", () => {
  assert.equal(checkTicketLink(pr("", { labels: ["No-Ticket"] })).ok, true);
});

test("a no-ticket label passes without a link", () => {
  const result = checkTicketLink(pr(template, { labels: ["no-ticket"] }));
  assert.equal(result.ok, true);
  assert.match(result.reason, /no-ticket/);
});

test("another label does not exempt the PR", () => {
  assert.equal(
    checkTicketLink(pr(template, { labels: ["dependencies"] })).ok,
    false,
  );
});

test("an annotation escapes percent, CR and LF", () => {
  assert.equal(
    errorAnnotation("T", "50%\r\nx"),
    "::error title=T::50%25%0D%0Ax",
  );
});

// The workflow runs the entry script; so do these, against a written payload.
const script = fileURLToPath(new URL("./pr-ticket-link.mjs", import.meta.url));
const repository = {
  html_url: "https://github.com/solana-foundation/solana-playground",
  default_branch: "master",
};

function run(event) {
  const dir = mkdtempSync(join(tmpdir(), "pr-ticket-link-"));
  const env = {
    ...process.env,
    GITHUB_EVENT_PATH: join(dir, "event.json"),
    GITHUB_STEP_SUMMARY: join(dir, "summary.md"),
  };
  writeFileSync(env.GITHUB_EVENT_PATH, JSON.stringify(event));
  writeFileSync(env.GITHUB_STEP_SUMMARY, "");
  const { status, stdout } = spawnSync(process.execPath, [script], {
    env,
    encoding: "utf8",
  });
  return {
    status,
    stdout,
    summary: readFileSync(env.GITHUB_STEP_SUMMARY, "utf8"),
  };
}

const prEvent = (body, labels = []) => ({
  pull_request: {
    body,
    user: { login: "ocatave" },
    labels: labels.map((name) => ({ name })),
  },
  repository,
});

test("the script fails the template with the fix and the template link", () => {
  const { status, stdout, summary } = run(prEvent(template));
  assert.equal(status, 1);
  assert.match(stdout, /^::error title=No Linear ticket link::/);
  for (const text of [stdout, summary]) {
    assert.match(text, /issue\/HOO-123/);
    assert.match(text, /no-ticket/);
    assert.ok(
      text.includes(
        `${repository.html_url}/blob/master/.github/pull_request_template.md`,
      ),
    );
  }
});

test("the script passes a linked body and a no-ticket label", () => {
  const linked = run(
    prEvent("Linear: https://linear.app/solana-fndn/issue/HOO-2314"),
  );
  assert.equal(linked.status, 0);
  assert.match(linked.stdout, /passed: links/);
  assert.equal(run(prEvent(template, ["no-ticket"])).status, 0);
});

test("the script fails a payload that is not a pull request", () => {
  const { status, stdout } = run({ repository });
  assert.equal(status, 1);
  assert.match(stdout, /Not a pull_request event/);
});
