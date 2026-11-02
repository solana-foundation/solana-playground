# Spec Delta

## Purpose

Holds every project to a size and a file count, in the explorer and in sync,
so an upload never meets a platform limit by surprise and the user is told what
to shrink at the moment a limit is reached.

## ADDED Requirements

### Requirement: A synced file holds at most 128 KiB

A file's size SHALL be the UTF-8 byte length of its content. A file of up to
131,072 bytes SHALL sync. A file of 131,073 bytes or more SHALL put its project
over the file size limit.

#### Scenario: A file at the limit syncs
- **WHEN** a project holds a file of exactly 131,072 bytes and is under every other limit
- **THEN** the upload is sent and accepted

#### Scenario: A file one byte over the limit stops the project
- **WHEN** a project holds a file of 131,073 bytes
- **THEN** the project is over the file size limit and no upload is sent

#### Scenario: Multi-byte characters count as bytes
- **WHEN** a file holds 50,000 characters that each encode to 3 UTF-8 bytes
- **THEN** its size is 150,000 bytes and the project is over the file size limit

### Requirement: A synced file path is at most 256 characters

A path's length SHALL be its count of Unicode code points, measured on the path
as sync sends it (relative to the workspace). A path of 257 code points or more
SHALL put its project over the path limit.

#### Scenario: A path of 256 characters syncs
- **WHEN** a project holds a file whose path is 256 code points long and is under every other limit
- **THEN** the upload is sent and accepted

#### Scenario: A path of 257 characters stops the project
- **WHEN** a project holds a file whose path is 257 code points long
- **THEN** the project is over the path limit and no upload is sent

### Requirement: A synced project holds at most 512 KiB

A project's size SHALL be the sum of the sizes of every file sync uploads for
it, the generated workspace files included. A project of up to 524,288 bytes
SHALL sync. A project of 524,289 bytes or more SHALL be over the project size
limit.

#### Scenario: Five files of 100 KiB stop the project
- **WHEN** a project holds five files of 102,400 bytes each and nothing else
- **THEN** its size is 512,000 bytes and the upload is sent
- **WHEN** a sixth file of 13,000 bytes is added
- **THEN** its size is 525,000 bytes and no upload is sent

### Requirement: A synced project has at most 50 files

A project's file count SHALL be the number of files sync uploads for it, minus
the generated workspace files (`.tutorial.json`,
`.workspace/tutorial-storage.json`, `.workspace/program-info.json`). A project
of up to 50 counted files SHALL sync. A project of 51 or more SHALL be over the
file count limit, whatever the files' sizes.

#### Scenario: Fifty files and the generated files sync
- **WHEN** a tutorial project holds 50 files of its own plus the three generated workspace files
- **THEN** the upload is sent and accepted

#### Scenario: Fifty-one empty files stop the project
- **WHEN** a project holds 51 files of its own, each of them empty
- **THEN** the project is over the file count limit and no upload is sent

### Requirement: The client checks the whole project before every upload

Before each upload, the client SHALL check the project's full file set against
every limit, also when the upload is a patch carrying only changed files. A
project over any limit SHALL NOT be uploaded, its sync mark SHALL stay as it
was, and further uploads for that project SHALL stop until the user retries.

#### Scenario: A one-line edit to a large project is not sent
- **WHEN** a project already over the project size limit has one file edited
- **THEN** no request reaches `PUT /api/projects`
- **AND** the project's sync mark is unchanged

#### Scenario: Other projects keep syncing
- **WHEN** project A is over a limit and project B, under every limit, is edited
- **THEN** project B's upload is sent and accepted

### Requirement: The banner names the limit and what is over it

A project stopped by a limit SHALL show the sync banner (`data-testid="sync-banner"`, `role="alert"`) for that
project with one "Try again" action. The banner SHALL name one limit, the first
of path, file size, file count, project size that the project is over. It SHALL
show sizes in KB, rounded up from bytes divided by 1,024.

#### Scenario: One file over the file size limit
- **WHEN** `src/lib.rs`, of 143,360 bytes, is the only file over a limit
- **THEN** the banner reads "src/lib.rs is 140 KB. A file can be at most 128 KB. Shrink or remove it, then try again."

#### Scenario: Several files over the file size limit
- **WHEN** five files are over the file size limit
- **THEN** the banner names the first three paths in sorted order and says "and 2 more"

#### Scenario: A path over the path limit
- **WHEN** one file's path is longer than 256 characters
- **THEN** the banner says a file path is longer than 256 characters, names the path cut to its first 60 characters followed by "…", and asks the user to rename or move it

#### Scenario: Too many files
- **WHEN** a project holds 64 counted files
- **THEN** the banner reads "This project has 64 files. A project can have at most 50. Remove some, then try again."

#### Scenario: Project over the size limit
- **WHEN** a project of 614,400 bytes is under every other limit
- **THEN** the banner reads "This project is 600 KB. A project can be at most 512 KB. Remove or shrink some files, then try again."

#### Scenario: Two limits at once
- **WHEN** a project holds 60 counted files and one file over the file size limit
- **THEN** the banner names the file size limit and the file

### Requirement: Try again re-checks before it uploads

"Try again" on a limit banner SHALL check the project against every limit
again. When the project is under every limit, the banner SHALL close and the
upload SHALL be sent. When it is still over one, the banner SHALL stay, updated
to the limit and files that apply now, and no upload SHALL be sent.

#### Scenario: The user removed the large file
- **WHEN** the banner names `src/big.rs`, the user deletes it, and presses "Try again"
- **THEN** the banner closes and the project's upload is accepted

#### Scenario: The user fixed one of two problems
- **WHEN** the banner names a file over the size limit, the user shrinks it, and the project still has 60 counted files
- **THEN** "Try again" sends nothing and the banner now names the file count limit

#### Scenario: The user undid the edit
- **WHEN** the banner names `src/lib.rs` after a paste over the size limit, the user undoes the paste so the project is again what the account holds, and presses "Try again"
- **THEN** the banner closes and no request reaches `PUT /api/projects`

### Requirement: The server refuses a write that leaves a project over a limit

`PUT /api/projects` SHALL refuse a write whose resulting project is over a limit,
for a full write and for a patch alike, with status 413 and a JSON body carrying
`reason`, one of `path-too-long`, `file-too-large`, `too-many-files`,
`project-too-large`, chosen in that order. A refused write SHALL change nothing
in the database. It SHALL refuse with 400 a write carrying a path under
`.workspace/` other than the synced workspace files, and its measure of a
project SHALL leave such stored rows out.

#### Scenario: A patch that adds the 51st file (manual)
- **WHEN** the account's project holds 50 counted files and a patch adds one more
- **THEN** the response is 413 with `reason: "too-many-files"` and `count: 51`
- **AND** the project's files and `updated_at` are unchanged

#### Scenario: A file over the size limit names itself (manual)
- **WHEN** a full write carries `src/big.rs` of 200,000 bytes
- **THEN** the response is 413 with `reason: "file-too-large"` and `paths: ["src/big.rs"]`

#### Scenario: A patch whose own files are small but whose project is large (manual)
- **WHEN** the stored project holds 500,000 bytes and a patch changes one file from 1,000 to 30,000 bytes
- **THEN** the response is 413 with `reason: "project-too-large"` and `size: 529000`

#### Scenario: A .workspace/ file sync does not carry (manual)
- **WHEN** a write carries `.workspace/metadata.json`
- **THEN** the response is 400 and nothing is stored

### Requirement: The refusal body says what is over

A 413 for a limit SHALL carry `limit` (the limit, in bytes, code points or files)
and, by reason, `paths` (every path over it, sorted) for `path-too-long` and
`file-too-large`, `count` for `too-many-files`, and `size` (bytes) for
`project-too-large`. The client SHALL raise the same banner from this body as
from its own check.

#### Scenario: The client check is bypassed
- **WHEN** a client whose check passed receives 413 with `reason: "too-many-files"` and `count: 52`
- **THEN** the banner reads "This project has 52 files. A project can have at most 50. Remove some, then try again."

### Requirement: The request body is capped at 1 MiB

`PUT /api/projects` SHALL refuse a body over 1,048,576 bytes with 413 and
`reason: "too-large"`, before parsing it. A body under the cap that holds a
project under every limit SHALL be accepted.

#### Scenario: A full upload of a project at the size limit fits (manual)
- **WHEN** a project of 524,288 bytes whose content is JSON-escaped to under 1,048,576 bytes is uploaded in full
- **THEN** the upload is accepted

#### Scenario: An oversized body (manual)
- **WHEN** a request body of 1,048,577 bytes arrives
- **THEN** the response is 413 with `reason: "too-large"` and the banner says the project is too large to sync

### Requirement: A project already over a limit can still be read and deleted

The limits SHALL apply to writes only. A stored project over a limit SHALL still
be listed, read, restored on a device and deleted. Its next upload SHALL be
refused until it is under every limit.

#### Scenario: Restoring a stored project over the limit
- **WHEN** an account holds a 2 MB project stored over the limit and a fresh device signs in
- **THEN** the project is restored on that device
- **AND** the first edit raises the project size banner instead of uploading

#### Scenario: Deleting it
- **WHEN** the user deletes that project
- **THEN** the delete reaches the server and succeeds

### Requirement: A project under every limit syncs as before

A project under every limit SHALL sync exactly as it did before the limits:
same requests, same sync mark, no banner, and no limit event.

#### Scenario: A tutorial project
- **WHEN** the user edits a file in a tutorial project of 12 KB and 3 files
- **THEN** one upload is sent and accepted, and no limit event fires

### Requirement: Limit refusals are measured

The persistence slice SHALL send one event each time a limit banner is raised,
by a check or by a server refusal, named for the limit the banner shows. `by`
SHALL be `client` when the client's own check raised it and `server` when a 413
body did. A body cap refusal (`too-large`) SHALL send no limit event.

#### Scenario: sync_file_limit_exceeded
- **WHEN** the banner is raised for the file size limit or the path limit
- **THEN** `sync_file_limit_exceeded` fires once with `by` (`client` | `server`), `limit` (`size` | `path`) and `files` (how many files are over that limit, an integer of 1 or more)

#### Scenario: sync_project_limit_exceeded
- **WHEN** the banner is raised for the project size limit
- **THEN** `sync_project_limit_exceeded` fires once with `by` (`client` | `server`) and `kib` (the project size in KiB, rounded up, an integer above 512)

#### Scenario: sync_files_count_limit_exceeded
- **WHEN** the banner is raised for the file count limit
- **THEN** `sync_files_count_limit_exceeded` fires once with `by` (`client` | `server`) and `files` (the counted files, an integer above 50)

#### Scenario: A banner already up sends nothing more
- **WHEN** a project's limit banner is up and the user keeps editing it
- **THEN** no further limit event fires until "Try again" raises the banner again

### Requirement: The explorer refuses to create a file past a limit

Creating or overwriting a file (from the New File dialog, an assistant file
write or a terminal command) SHALL be refused when the write breaks one of these
limits, checked in this order:

1. Path: the file's path is longer than 256 characters.
2. File size: the file's new content is larger than 128 KB.
3. File count: the file is new, and adding it gives the project more than 50
   files.
4. Project size: the write makes the project bigger, and leaves it larger than
   512 KB.

An overwrite that adds no file and makes the project no bigger SHALL NOT be
refused, even in a project already over a limit. A refused write SHALL change
nothing. The refusal message SHALL be the rule of the first limit broken: "A
file path can be at most 256 characters.", "A file can be at most 128 KB.", "A
project can have at most 50 files." or "A project can be at most 512 KB."

#### Scenario: The 51st file from the New File dialog
- **WHEN** a project holds 50 counted files and the user creates `src/extra.rs` in the New File dialog
- **THEN** no file is created
- **AND** the dialog stays open showing "A project can have at most 50 files." in an element with `data-testid="explorer-limit-error"`

#### Scenario: A folder is not a file
- **WHEN** a project holds 50 counted files and the user creates a folder
- **THEN** the folder is created

#### Scenario: The assistant writes a file over the size limit
- **WHEN** the assistant's file write sends 200,000 bytes for `src/lib.rs`
- **THEN** `src/lib.rs` keeps its previous content
- **AND** the write fails with the message "A file can be at most 128 KB.", which the assistant receives as the tool's error
- **AND** its approval card is marked "Failed" and reads "not written: A file can be at most 128 KB."

#### Scenario: A project already over a limit
- **WHEN** a project restored from the account holds 60 counted files and the user creates another file
- **THEN** no file is created and the dialog shows "A project can have at most 50 files."

#### Scenario: An edit in a project already over a limit (manual)
- **WHEN** a project restored from the account holds 60 counted files and the assistant overwrites an existing file with smaller content
- **THEN** the file is written and nothing is refused

#### Scenario: A small file beside a file over the size limit
- **WHEN** `src/lib.rs` is 150,000 bytes after a paste and the user creates `notes.md` in the New File dialog
- **THEN** `notes.md` is created

### Requirement: The explorer refuses a rename past the path limit

Renaming or moving a file or a folder SHALL be refused when any file path it
produces is longer than 256 code points. A refused rename SHALL change nothing,
and the rename dialog SHALL show "A file path can be at most 256 characters."
in its `data-testid="explorer-limit-error"` element.

#### Scenario: Renaming a folder pushes a file over
- **WHEN** a folder holds a file whose path is 250 code points long and the user renames the folder to a name 10 code points longer
- **THEN** the folder keeps its old name and the dialog shows the path message

### Requirement: An import past a limit creates nothing

Creating a workspace from files (import from disk, from GitHub, from a
temporary project, a template or a tutorial) SHALL be refused when those files
are over a limit. No workspace SHALL be created. The import dialog SHALL show
the first limit's measure and rule, worded as the sync banner words it without
its last sentence, in its `data-testid="explorer-limit-error"` element.

#### Scenario: A folder of 64 files from disk
- **WHEN** the user imports a local folder holding 64 files
- **THEN** no workspace is created
- **AND** the import dialog shows "This project has 64 files. A project can have at most 50."

#### Scenario: A GitHub repository with one large file
- **WHEN** the user imports a GitHub repository whose `src/data.rs` is 143,360 bytes
- **THEN** no workspace is created and the dialog shows "src/data.rs is 140 KB. A file can be at most 128 KB."

#### Scenario: Every bundled template and tutorial fits (manual)
- **WHEN** a workspace is created from each framework template and each tutorial the client ships
- **THEN** none is refused

### Requirement: Editor writes and restores are not refused

Saving a file the user typed or pasted into in the editor, and writing a
project restored or merged from the account, SHALL NOT be refused by a limit. A
project that goes over a limit this way SHALL be reported by the sync banner on
its next upload.

#### Scenario: Pasting past the file size limit
- **WHEN** the user pastes text that brings `src/lib.rs` to 150,000 bytes
- **THEN** the editor saves the file
- **AND** for a signed-in user, the next upload is not sent and the banner names `src/lib.rs`

#### Scenario: Restoring a large project
- **WHEN** a fresh device restores a 2 MB project from the account
- **THEN** every file is written to the workspace

### Requirement: Explorer refusals are measured

The explorer SHALL send `explorer_limit_refused` once for each refused create,
rename or import, with `action` (`create` | `rename` | `import`) and `limit`
(`path` | `size` | `count` | `project`, the limit the message names).

#### Scenario: The 51st file
- **WHEN** the New File dialog refuses a file for the file count limit
- **THEN** `explorer_limit_refused` fires once with `action: "create"` and `limit: "count"`

#### Scenario: A refused import
- **WHEN** an import is refused for the project size limit
- **THEN** `explorer_limit_refused` fires once with `action: "import"` and `limit: "project"`
