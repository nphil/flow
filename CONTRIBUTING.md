# Contributing

Thank you for considering contributing to Flow. This document explains how to set up the repository locally, run the project, run tests, and the preferred workflow for making changes, opening pull requests and preparing releases.

**Please read these guidelines before opening a PR.**

## Quick Start

- **Clone the repo**:
  - `git clone <repo-url>`
  - `cd haflow`
- **Install**: The repository uses Yarn 4 workspaces. From the repository root run:
  - `yarn install`
- **Start development**: To run the frontend in watch/dev mode for local development:
  - `yarn dev` (from the `haflow` folder in monorepo the root scripts will route properly)

## Project Structure (short)

- `packages/frontend` — React + Vite frontend UI
- `packages/shared` — shared types & Zod schemas
- `packages/transpiler` — YAML parsing & transpilation
- `custom_components/flow` — Home Assistant integration (Python)

See the repository root and the `packages` folder for the full layout.

## Common Commands

- Install dependencies: `yarn install`
- Start frontend dev server: `yarn dev`
- Build all packages: `yarn build`
- Build and copy to Home Assistant component: `yarn build:ha`
- Run tests: `yarn test` (use `--run` to avoid Vitest watch mode when necessary)
- Run the round-trip fixtures on their own: `yarn test:roundtrip`
- Typecheck: `yarn typecheck`
- Lint/format: `yarn check` and `yarn format`

If you need to run a command inside a package, change into that package directory and run the command there (for example `cd packages/frontend && yarn dev`).

## Development Guidelines

- Keep TypeScript strict — the codebase is compiled with `--strict` and must remain type-safe.
- Avoid `any`, `as` assertions, and `@ts-ignore` except when interacting with unavoidable external APIs; prefer `unknown` + type guards instead.
- Use `@flow/shared` types and Zod schemas for shared shapes — do not re-declare common types.
- Extract reusable logic to helpers or custom hooks rather than duplicating code.
- In React/TypeScript files: do not use IIFEs; prefer named components or helper functions.

## Tests

- Unit tests use Vitest. Run all tests with `yarn test` from the repository root or run the package-local tests inside `packages/*`.
- When adding tests, aim for deterministic, fast tests. Use fixtures in `packages/transpiler/fixtures` or `__tests__/yaml-automation-fixtures` where appropriate.
- The round-trip fixtures (Home Assistant configs that must open and save in Flow with the same meaning) run with `yarn test:roundtrip`, and CI reports them as a separate step.

## Branching, Commits & Pull Requests

- Create a short-lived feature branch from `main`: `git checkout -b feat/short-description`.
- Make small, focused commits with clear messages. Use present-tense, imperative form (e.g., "Add X feature").
- Run `yarn typecheck`, `yarn test`, `yarn check`, and `yarn format` before opening a PR.
- Open a pull request against `main`. In the PR description, include:
  - What the change does and why
  - Any breaking changes
  - Manual steps to test (if applicable)

## Code Review

- Be responsive to review comments. The reviewer may ask for additional tests or stricter types.
- Keep changes focused; if a review requests a larger refactor, consider creating follow-up PRs.

## Home Assistant Build / Deploy

- The repository includes scripts to copy builds into the Home Assistant custom component directory. Use `yarn build:ha` from the repo root to build and copy files.
- Three files carry the release version and must always agree: [custom_components/flow/manifest.json](custom_components/flow/manifest.json#L1) (HACS), `flow_web/config.yaml` and the `ARG BUILD_VERSION` line of `flow_web/Dockerfile` (the Home Assistant add-on). Do not edit them by hand: `yarn release:bump <version>` writes all three and `yarn release:check` verifies them.

## CI

Every pull request and every push to `main` runs these GitHub Actions workflows (see `.github/workflows`). Keep them green:

- **CI** — typecheck, Biome lint and format check, unit tests, the round-trip fixtures, and a full build including the Home Assistant bundle. The built integration is attached to the run as the `flow` artifact, so a pull request can be tried in Home Assistant.
- **HACS Validation** — the HACS action, hassfest, and a check that the three version files agree. It also runs every night.
- **Add-on** — the Home Assistant app linter on `flow_web`, and a build of the add-on image against the newest published release.

## Releases

A release is a git tag; the Release workflow does the rest. Maintainers do not cut one without the owner's go-ahead.

1. `yarn release:bump 1.3.0` sets the version in the three files above (`yarn release:check` confirms they agree).
2. Commit them: `git commit -m "chore(release): v1.3.0"`.
3. Tag and push: `git tag v1.3.0 && git push origin main v1.3.0`.

The workflow checks that the tag and the version files agree, runs CI, builds `flow.zip` and `flow.tar.gz`, creates the GitHub Release (its notes are generated from the commit history, grouped by `feat`, `fix` and everything else, so write conventional commit subjects), and pushes `ghcr.io/nphil/flow:1.3.0` (plus `latest` for stable versions). HACS and the Home Assistant add-on pick the release up from there: HACS reads `flow.zip`, and the add-on image downloads the `flow.tar.gz` of its own version.

- **Pre-release:** a version such as `1.4.0-rc.1` creates a GitHub pre-release and leaves the `latest` image alone.
- **Rehearsal:** `gh workflow run release.yml --ref <branch> -f version=1.3.0` builds and tests everything but publishes nothing (`dry_run` is on by default). The files stay available as a workflow artifact.
- **By hand:** a release created in the GitHub UI works too. The workflow attaches the files and keeps your title and notes.

## Adding Packages or Tests

- When adding new packages under `packages/`, add workspace entries and update root `package.json` if required.
- Keep package `tsconfig.json` and `vitest.config.ts` consistent with existing packages.

## Security & Sensitive Data

- Do not commit secrets, credentials, or Home Assistant tokens into the repository. Use environment variables or secure secret stores.

## Getting Help

- If you are unsure about something, open an issue or ask maintainers on the project's communication channel.

Thank you for helping improve Flow! We appreciate careful, well-tested contributions.
