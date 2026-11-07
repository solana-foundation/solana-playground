## Why

During a devnet deploy on the 7 Nov call, the console strip's Stop did
nothing the person could see, and the terminal stayed busy. A button that
promises a stop and does not keep it is worse than no button
([HOO-2711](https://linear.app/solana-fndn/issue/HOO-2711)).

## What Changes

- The console strip shows Stop only while a build runs, including the build
  a deploy runs first. A deploy alone shows no Stop.
- Ctrl+C and ⌘. in the terminal still stop a deploy while it funds and
  writes, as before; the deploy scenarios now say so.
- How the strip's Stop should work for a deploy is left for a later task.

## Impact

- `client-v2/src/views/flow/console/status.ts` (`runToStop`) and its test.
- Spec `client-v2-command-stop`.
