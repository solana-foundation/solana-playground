# Tasks

## 1. Fence an ended session's chat threads ([HOO-2757](https://linear.app/solana-fndn/issue/HOO-2757))

- [x] 1.1 Failing tests first: account A's thread on the device, A's session ended, B signs in; `pushAll` sends no A thread, and A signing in again gets its thread back
- [x] 1.2 `PgThreadFence` (`features/persistence/model/thread-fence.ts`): owner file, `settle(userId)` fencing another owner's threads and restoring the user's own, straggler re-fence; `push` refuses a fenced thread; `forget` clears the owner after a whole hand-over (depends on 1.1)
- [x] 1.3 Session effect: on another account's sign-in stop the turn, close the thread, settle before the chat adoption and dump, reopen the panel's thread (depends on 1.2)
- [x] 1.4 e2e `client-v2-account: Another account after a session ended`: a stubbed 401 ends A's session, B signs in, no `/api/conversations` request carries A's thread id (depends on 1.3)
