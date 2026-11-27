---
weight: 0.8
test: judgement
---

A text never describes what the code it names already states; it gives only the non-obvious why.

Fails: `` `parseConfig` reads the file, splits it into lines, and returns a map of keys to values. ``
Passes: `` `parseConfig` accepts duplicate keys because the deploy tool appends overrides at the end. ``
