# Plan: tasks 1.1, 2.1, 2.2 (one PR, HOO-1749)

Inline execution, TDD per step. Paths relative to `client-v2/src/`.

1. **Registry tests first** — `entities/agent-tools/model/registry.test.mjs`
   (`node --test`, through `server.mjs`):
   nine names in order (list_skills, load_skill, read_skill_reference,
   list_files, read_file, get_build_error, write_file, build, deploy), unique,
   non-empty descriptions, object schemas with `additionalProperties: false`;
   approval exactly on write_file/build/deploy; `DEFAULT_MCP_SERVERS` holds
   solana; catalogue ids playground-env, solana-dev, bundled source carries no
   content.
2. **Registry** — `model/registry.mjs` (JSDoc types, no imports), descriptions
   and schemas copied byte-for-byte from today's `tools.ts`/`skill-tools.ts`;
   `index.ts` re-exports with TS types; `server.mjs` re-exports.
3. **Panel parity tests** — in `views/sidebar/assistant/model/tools.test.ts`
   (unmocked skill tools for this block): built-in names == registry names;
   each description/schema equals its declaration; each `approval` tool, with
   a fake bridge and approval declined, requested approval and touched nothing;
   each unmarked tool neither asks nor changes anything.
4. **Panel binds runners** — `bindTool(name, run)` in `entities/agent-tools`
   copies the declaration and throws on an undeclared name; `tools.ts` and
   `skill-tools.ts` replace each inline declaration with it, runners unchanged;
   MCP tools stay between the skill and project groups.
5. **Skills** — `grounding/registry.ts` maps `SKILL_CATALOGUE` adding bundled
   content by id; test for missing content.
6. `yarn run check`, then the sx gate.
