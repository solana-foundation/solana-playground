# Tasks

## 1. The status route

- [x] 1.1 Add `client-v2/api/ai.mjs` serving `GET`/`HEAD /api/ai/status` per
      the `assistant-ai-status` spec, and the `vercel.json` rewrite
      `/api/ai/status` -> `/api/ai`. Verify with `yarn test-api`: cases in
      `api/ai.test.mjs` for no key, key without sign-in, signed out, signed in,
      a failed session lookup, the key absent from the body and headers,
      `no-store`, and `405` on `POST`; and `api-routing.test.mjs` passing with
      `/api/ai/status` in its list of browser-called paths (HOO-1746; no
      dependencies)
- [ ] 1.2 Call `GET /api/ai/status` on the `scope/ai-rail` preview, signed
      out and signed in, and record both answers on HOO-1746. A ticket branch
      gets no preview, so this runs once 1.1 has merged (HOO-1746; after 1.1)
