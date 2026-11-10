## Why

Build succeeded offers Continue to Deploy as its brand action even after the
code changed, so the screen leads people to deploy an old build. Almaz named
the fix on Slack on 3 Nov: Build again becomes the main button once the code
changed after the build (HOO-2589).

## What changes

- The flow state knows whether the program's source differs from what the last
  successful build was given.
- With a difference, Build succeeded leads with Build again and says why;
  Continue to Deploy steps down and keeps working.
- The success line drops "Edited since?", which asked what the app now knows.

## Impact

`views/flow/state/stage.ts`, `views/flow/stages/Build.tsx` and `BaseBuild.tsx`.
No storage: after a reload the surface is "Built earlier", which claims no
comparison with the code.
