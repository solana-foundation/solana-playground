# client-v2 targets. Run from this directory.
# Mirrors the root Makefile's `## description` help convention.

.DEFAULT_GOAL := help

.PHONY: help e2e-full

help: ## Show this help
	@printf 'Usage: make <target>\n\nTargets:\n'
	@sed -nE 's/^([a-zA-Z0-9_%-]+):.*## (.*)$$/  \1: \2/p' $(MAKEFILE_LIST)

# Installs both browsers first; a browser already present is not downloaded again.
e2e-full: ## Run the whole e2e suite on Chromium and Firefox
	yarn playwright install chromium firefox
	E2E_FULL=1 yarn test-e2e --project=chromium --project=firefox
