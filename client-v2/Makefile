# client-v2 targets. Run from this directory.
# Mirrors the root Makefile's `## description` help convention.

.DEFAULT_GOAL := help

.PHONY: help update-static

help: ## Show this help
	@printf 'Usage: make <target>\n\nTargets:\n'
	@sed -nE 's/^([a-zA-Z_%-]+):.*## (.*)$$/  \1: \2/p' $(MAKEFILE_LIST)

# `public/` is gitignored, not a submodule: a submodule's git dir is shared across
# linked worktrees, so initialising it in one detaches it in every other. The script
# sources from the primary checkout and inits `client/public` there if needed.
# `yarn start`/`yarn build` run this too, so it is rarely needed by hand.
update-static: ## Refresh public/ from the client/public assets submodule
	node scripts/update-static.mjs
