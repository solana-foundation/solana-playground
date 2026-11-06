## Why

GitHub heads a gist's page with its first file in byte order, and it has no title field. Every shared gist is headed `.playground.json`, so a reader cannot tell what it holds (HOO-2546).

## What Changes

- An exported gist holds one more file, `!<project name>`, which sorts ahead of the manifest and so heads the page.
- The share dialog names that file beside the manifest.
- The manifest and its version do not change. An import writes only what the manifest lists, so it skips the new file, and gists shared before keep opening.

## Capabilities

### Modified Capabilities

- `gist-sharing`: a new requirement for the file that titles the gist.

## Impact

`client-v2/src/features/gist/lib/format.ts`, `model/export.ts`, `ui/BaseShareGist.tsx`.
