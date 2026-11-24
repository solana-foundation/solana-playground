import assert from "node:assert/strict";
import { test } from "node:test";

import { GA4_ID } from "./google-tag.mjs";

test("google-tag accepts a GA4 id", () => {
  assert.ok(GA4_ID.test("G-ABC123"));
});

// A Universal Analytics id, and a valid prefix carrying markup after it
for (const id of ["UA-12345-1", 'G-1"</script>']) {
  test(`google-tag refuses ${JSON.stringify(id)}`, () => {
    assert.ok(!GA4_ID.test(id));
  });
}
