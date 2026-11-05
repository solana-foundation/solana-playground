## ADDED Requirements

### Requirement: Head the gist with the project's name

Every exported gist SHALL hold a file named `!` followed by the project's name, with `/` replaced by `__`, trimmed and cut to 60 code points. It sorts ahead of the manifest, so GitHub heads the gist's page with it. A project file of the same name SHALL get a counter. The share dialog SHALL name this file beside the manifest. An import SHALL NOT write it, and a gist without it SHALL open as before.

#### Scenario: The title sorts first (manual)

- **WHEN** a project named `counter` holding `.env.example` and `Anchor.toml` is flattened
- **THEN** the first of the gist's names in byte order is `!counter`
- Pinned by client-v2/src/features/gist/lib/format.ts: "titles the gist after the project: its file sorts first"

#### Scenario: An import leaves it out (manual)

- **WHEN** a gist is read back, with the title file or without it
- **THEN** the title file is not among the project's files, and the paths and name are the exported ones
- Pinned by client-v2/src/features/gist/lib/format.ts: "an import leaves the title out, and a gist without one opens"
