# Spec Delta

## MODIFIED Requirements

### Requirement: The export reports what it did

The `project-export` slice SHALL send `export_convert_failed`, when
"Convert and export" could not convert and the dialog falls back to the
plain zip, with `profile` (`anchor`, `native`, `seahorse`, `typescript`;
`unknown` when no framework recognised the program) and `reason`
(`unknown-framework`, or `error` for any other failure, which is also
reported).

The zip's outcome is counted where the export started, not in this slice:
`exportAsIs` SHALL resolve with the number of files in the zip, and
`exportConverted` with the README, the conversion's `profile` and that
count, and the caller sends `project_exported` and `project_export_failed`
through `features/project-files` (spec `client-v2-project-files`, "An
export is counted with where it started" and "The settings page's export is
counted"). A zip that did not download SHALL fail with `isDownloadFailure`,
naming the `profile` of the zip, and a converted zip that did not download
SHALL NOT be retried as is.

#### Scenario: A TypeScript export is counted (manual)

- **WHEN** the user converts and exports a project with no program holding
  two files
- **THEN** `project_exported` is sent with `via` `dialog`, `profile`
  `typescript` and `files` 7 (the two files and the five the profile adds)

#### Scenario: An unknown framework falls back (manual)

- **WHEN** "Convert and export" meets a program no framework recognises
- **THEN** `export_convert_failed` is sent with `profile` `unknown` and
  `reason` `unknown-framework`, then `project_exported` once with `profile`
  `as-is` and `converted` `false`
