.PHONY: help setup dev build-examples preview-examples kill-port build typecheck test test-e2e test-e2e-ui test-e2e-headed test-e2e-install verify package publish publish-rc publish-dry clean clean-dist check-version update-deps

help: ## Show this help message
	@echo "Available targets:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  %-18s %s\n", $$1, $$2}'

setup: ## Install dependencies and prepare project
	@echo "Installing dependencies..."
	npm install
	@echo "Setup complete"

dev: ## Start the vite dev server (example pages, port 15000 - package.json#kmwc.ports.dev)
	@echo "Starting development server..."
	@rm -rf node_modules/.vite
	npm run dev

build-examples: ## Build the static examples site (vite --mode examples -> dist-examples/)
	npm run build:examples

preview-examples: ## Serve the built examples site (port 15001)
	npm run preview:examples

# Free core's own dev-server ports: 15000 (dev) and 15001 (examples preview), the
# registry block in web-components/components.json. The devkit preset runs vite with
# strictPort, so it never hops to a neighbouring port (and never onto another repo's).
# Kills whatever is LISTENING on those ports, covering both IPv4 and IPv6 (vite binds [::1] too).
# On Windows a one-line PowerShell call does the work: Get-NetTCPConnection lists both
# IPv4 and IPv6 listeners, and Stop-Process kills each owning PID. Recipes here default
# to Git Bash (sh), so the recipe stays in sh and shells out to powershell rather than
# switching this target's SHELL to cmd.exe (a target-specific SHELL leaks and breaks the
# grep/awk-based help target). `$$_` escapes make's `$`, and the command is single-quoted
# so sh doesn't expand `$_` (its own last-arg variable) before PowerShell — PowerShell must
# receive a literal `$_` pipeline variable.
kill-port: ## Free core's vite ports (15000 dev, 15001 preview)
	@echo "Freeing ports 15000-15001..."
ifeq ($(OS),Windows_NT)
	-@powershell -NoProfile -Command '15000..15001 | ForEach-Object { Get-NetTCPConnection -LocalPort $$_ -State Listen -ErrorAction SilentlyContinue } | Select-Object -ExpandProperty OwningProcess -Unique | ForEach-Object { Stop-Process -Id $$_ -Force -ErrorAction SilentlyContinue }'
else
	-@for p in 15000 15001; do lsof -ti tcp:$$p | xargs -r kill -9; done
endif
	@echo "Ports 15000-15001 are free"

build: ## Build for production (tsc -> dist: ESM + .d.ts)
	@echo "Building for production..."
	npm run build
	@echo "Build complete - Files in ./dist"

typecheck: ## Type-check without emitting
	npm run typecheck

test: ## Run the unit test suite (vitest)
	npm test

test-e2e: ## Run Playwright e2e tests (headless)
	npm run test:e2e

test-e2e-ui: ## Run Playwright e2e tests in UI mode
	npm run test:e2e:ui

test-e2e-headed: ## Run Playwright e2e tests headed (watch the browser)
	npm run test:e2e:headed

test-e2e-install: ## Install chromium browser binary (one-time)
	npm run test:e2e:install

verify: ## Type-check + run the unit tests (the pre-publish gate)
	@echo "Verifying: typecheck + tests..."
	npm run typecheck
	npm test
	@echo "Verify complete"

package: build ## Create npm package (tarball)
	@echo "Creating package..."
	npm pack
	@echo "Package created - see above for details"

publish-dry: ## Publish to npm (dry run) - cleans dist first
	@echo "Running publish dry-run..."
	npm run clean:dist
	npm run build
	npm publish --dry-run
	@echo "Dry-run complete - Review the output above"

# This core is depended on by web-multiselect / web-daterangepicker / web-treeview,
# so publish and publish-rc run the full verify (typecheck + tests) before shipping.
publish: ## Publish to npm as 'latest' - verifies, then cleans + builds (use for release/patch/minor/major)
	@echo "WARNING: This will publish @keenmate/web-components-core to npm as the 'latest' dist-tag"
	@echo "Use 'make publish-rc' instead if you're shipping a pre-release version."
	@echo "Press Ctrl+C to cancel, or Enter to continue..."
	@powershell -Command "Read-Host | Out-Null"
	@echo "Verifying before publish..."
	npm run typecheck
	npm test
	@echo "Publishing to npm..."
	npm run clean:dist
	npm run build
	npm publish
	@echo "Published successfully"

publish-rc: ## Publish to npm under the 'rc' dist-tag (does NOT touch 'latest')
	@echo "WARNING: This will publish @keenmate/web-components-core to npm under the 'rc' dist-tag"
	@echo "The 'latest' tag will be untouched - consumers must opt in with @rc or @<version>."
	@echo "Press Ctrl+C to cancel, or Enter to continue..."
	@powershell -Command "Read-Host | Out-Null"
	@echo "Verifying before publish..."
	npm run typecheck
	npm test
	@echo "Publishing to npm under 'rc' tag..."
	npm run clean:dist
	npm run build
	npm publish --tag rc
	@echo "Published successfully under 'rc' tag"

clean: ## Clean build artifacts (dist + *.tgz)
	@echo "Cleaning build artifacts..."
	npm run clean
	@echo "Clean complete"

clean-dist: ## Clean only the dist folder
	@echo "Cleaning dist folder..."
	npm run clean:dist
	@echo "Dist cleaned"

check-version: ## Show current package version
	@echo "Current version:"
	@node -p "require('./package.json').version"

update-deps: ## Update dependencies
	@echo "Updating dependencies..."
	npm update
	@echo "Dependencies updated"

# Default target
.DEFAULT_GOAL := help
