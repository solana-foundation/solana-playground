# Proposal

## Why

Almaz's review of Spec 06 (DES-126, 4 Nov) left three dev items: nothing tells a screen reader that an indicator stopped being ready (RUN-40), the analyzer's Reload throws away a first build under way (RUN-33), and Deploy and Interact can still be pressed while the network is down (RUN-27, RUN-32). HOO-2625.

## What Changes

- One polite live region, mounted once in Flow, says an indicator's name and state once per change to Not ready. Working to Ready, and the first load, are silent. It leaves out what the line over the stage says already.
- The analyzer offers no Reload while a build or a deploy runs; its panel says Reload comes back when that ends.
- Deploy's pill and Interact's Test are held, with the reason beside them, while the browser is offline or the cluster does not answer.
- The `deploy` command refuses in the same words, so the assistant's tool, the file menu and the terminal cannot start one either.
- Telemetry: changes none. The region is not an action, and a held button cannot be pressed; `status_notice_shown` already measures the condition.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `client-v2-status`: the announcement, the holds, and when the analyzer offers Reload.

## Impact

`widgets/status`, `views/flow/Flow.tsx`, `views/flow/stages/{BaseDeploy,Deploy}`, `views/sidebar/test/Component/Instruction`, `commands/deploy`.

Out of scope: "Limit reached" and Try again (HOO-2582, #309); the line on what the opened example does (RUN-01, needs a design pass with DES-199); "Build green is announced once", which `BaseBuild` already does; layout and words of the status sheet (#318).
