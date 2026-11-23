## 1. Server

Plan: [plans/1-caps-and-no-project.md](plans/1-caps-and-no-project.md)

- [x] 1.1 Migration: `messages.bytes` stored column and a per-conversation covering index
- [x] 1.2 `CHAT_LIMITS` and the refusal shapes in `model/chat-limits.mjs`
- [x] 1.3 `appendMessages` measures the account under a per-account lock and refuses a push past a cap
- [x] 1.4 `ensureThread` refuses an unknown project instead of inserting it
- [x] 1.5 The route answers 413 with the cap and 409 `no-project`

## 2. Client

- [x] 2.1 `PgChatSync` reads both refusals into push outcomes and keeps the cap it was refused for
- [x] 2.2 A thread refused for `no-project` is pushed again once its project's push is accepted
- [x] 2.3 The assistant panel shows the cap line while it holds
- [x] 2.4 Sign-out flushes the current project before handing conversations over
