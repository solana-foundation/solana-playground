import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { checkTicketLink } from "./pr-ticket-link.mjs";

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
  const body = "https://linear.app/solana-fndn/issue/HOO-12abc";
  assert.equal(checkTicketLink(pr(body)).ok, false);
});

test("dependabot passes without a link", () => {
  const result = checkTicketLink(pr("", { author: "dependabot[bot]" }));
  assert.equal(result.ok, true);
  assert.match(result.reason, /dependabot/);
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
