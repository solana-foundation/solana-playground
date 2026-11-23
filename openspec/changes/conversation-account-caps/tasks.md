## 1. Server

Plan: [plans/1-caps-and-no-project.md](plans/1-caps-and-no-project.md)

- [ ] 1.1 Migration: `messages.bytes` stored column and a per-conversation covering index
- [ ] 1.2 `CHAT_LIMITS` and the refusal shapes in `model/chat-limits.mjs`
- [ ] 1.3 `appendMessages` measures the account under a per-account lock and refuses a push past a cap
- [ ] 1.4 `ensureThread` refuses an unknown project instead of inserting it
- [ ] 1.5 The route answers 413 with the cap and 409 `no-project`

## 2. Client

- [ ] 2.1 `PgChatSync` reads both refusals into push outcomes and keeps the cap it was refused for
- [ ] 2.2 A thread refused for `no-project` is pushed again once its project's push is accepted
- [ ] 2.3 The assistant panel shows the cap line while it holds
