# Spec Delta

## ADDED Requirements

### Requirement: The check refuses a start that is not the previous target

`yarn tutorial:check` SHALL refuse a step, other than the first, whose `start` differs from the previous step's `target`: a file the target has and the start lacks, a file the start has and the target lacks, or a file whose content differs. Each such file SHALL be one error at `steps[<i>].start["<file>"]` that names the previous step.

#### Scenario: A start retyped with a changed line
- **WHEN** step 2's `start` holds `src/lib.rs` with one line other than step 1's `target`
- **THEN** the check prints `steps[1].start["src/lib.rs"]: the same file as steps[0].target, found a different one` and exits with code 1

#### Scenario: A start missing a file
- **WHEN** step 1's `target` holds `client/client.ts` and step 2's `start` does not
- **THEN** the check prints `steps[1].start["client/client.ts"]: the file as steps[0].target has it, found none`

### Requirement: The authoring instruction ships as a skill

The repository SHALL hold a skill, `client-v2/src/tutorials/SKILL.md`, that tells a model to write a tutorial by `AUTHORING.md` and `tutorial.schema.json` and to hand the person a folder the check accepts. It SHALL hold no copy of either file. `yarn tutorial:skill` SHALL pack `SKILL.md`, `AUTHORING.md` and `tutorial.schema.json` into one zip, `tutorial-author.zip`, with the three files in one folder `tutorial-author/`, as Claude installs a skill; uploaded as plain files to any other LLM, the same three files SHALL be enough.

#### Scenario: Packing the skill
- **WHEN** an author runs `yarn tutorial:skill` in `client-v2/`
- **THEN** `tutorial-author.zip` holds `tutorial-author/SKILL.md`, `tutorial-author/AUTHORING.md` and `tutorial-author/tutorial.schema.json`, each byte for byte as in the repository
