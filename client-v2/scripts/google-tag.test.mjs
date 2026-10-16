import assert from "node:assert/strict";
import { test } from "node:test";

import { GTAG_SRC, insertGoogleTag } from "./google-tag.mjs";

const HTML =
  '<!doctype html><html lang="en"><head><meta charset="utf-8"/></head><body></body></html>';

test("google-tag places the tag right after <head>", () => {
  const html = insertGoogleTag(HTML, "G-ABC123");
  assert.ok(
    html.includes(
      `<head><script async src="${GTAG_SRC}?id=G-ABC123"></script><script>`
    )
  );
  assert.ok(html.includes('gtag("config","G-ABC123")'));
});

test("google-tag adds nothing when the html already loads gtag.js", () => {
  const once = insertGoogleTag(HTML, "G-ABC123");
  assert.equal(insertGoogleTag(once, "G-ABC123"), once);
});

// A Universal Analytics id, and a valid prefix carrying markup after it
for (const id of ["UA-12345-1", 'G-1"</script>']) {
  test(`google-tag refuses ${JSON.stringify(id)}`, () => {
    assert.throws(() => insertGoogleTag(HTML, id), /not a GA4 id/);
  });
}
