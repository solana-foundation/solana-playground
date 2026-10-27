# client-v2 docs

| Doc | What it covers |
| --- | --- |
| [Deploy the client to Vercel](deploy-client-vercel.md) | Release checklist, Vercel project settings, deploy targets, build cache, env vars, migrations |
| [Neon preview databases](neon.md) | Neon keys and project ID, a database branch per git branch, and their cleanup on merge |
| [Firewall](firewall.md) | Vercel Firewall rules for the `/api` routes: rate limits, the emergency switches, and how to verify them |
| [Running CI locally with act](local-ci-with-act.md) | The `.actrc` configuration, the commands per workflow, the amd64 override for `build`, and the host-side traps: port 5432, linked worktrees, leftover containers |
