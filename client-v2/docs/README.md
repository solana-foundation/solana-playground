# client-v2 docs

| Doc | What it covers |
| --- | --- |
| [Deploy the client to Vercel](deploy-client-vercel.md) | Release checklist, Vercel project settings, deploy targets, build cache, env vars, migrations |
| [Production runbook](production-runbook.md) | Production set up from nothing, in order, for the team that runs the infrastructure: the Vercel project, Cloud SQL, the keys and secrets, the Firewall, the first deployment and the release, each with its check; then deploys, migrations and spend in operation |
| [Cloud SQL for client-v2](cloud-sql.md) | The design of the Cloud SQL databases and their identities, and every setup step in Google Cloud, GitHub, and Vercel, from an empty production database to the previews |
| [Preview databases](preview-databases.md) | The shared Cloud SQL database every preview reads, a database of its own by the `preview` label, the sweep, and their configuration |
| [Neon preview databases](neon.md) | Neon keys and project ID, a database branch per git branch, and their cleanup on merge |
| [Firewall](firewall.md) | Vercel Firewall rules for the `/api` routes: rate limits, the emergency switches, and how to verify them |
| [Agent sources and tools](agent-sources-and-tools.md) | The JSON format of an MCP server entry: its fields, browser calls and CORS, and bot-protection bypasses |
| [Running CI locally with act](local-ci-with-act.md) | The commands to run a workflow's job under act, on x86-64 and arm64 hosts and from a worktree |
