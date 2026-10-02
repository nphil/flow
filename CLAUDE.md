## Coding Guidelines

- **Never use IIFEs (Immediately Invoked Function Expressions) in React components or TypeScript files.**
  - Always extract logic into a named component or custom hook instead of using IIFEs.
  - Use plain variables or helper functions for local logic, but prefer components for UI logic.
  - IIFEs are forbidden in all React and TypeScript code.

# Project Overview

**Flow** is a visual flow editor for Home Assistant automations, inspired by Node-RED. It allows users to design automations as diagrams and transpiles them to 100% native Home Assistant YAML—no vendor lock-in. Automations remain editable in HA’s built-in editor.

# Repository Structure

```
haflow/
├── packages/
│   ├── shared/          # @flow/shared - Types and Zod schemas
│   ├── frontend/        # @flow/frontend - React UI (Vite + Tailwind)
│   └── transpiler/      # @flow/transpiler - YAML parser/generator
├── custom_components/flow/  # Home Assistant integration (Python)
└── .github/workflows/       # CI/CD pipelines
```

# Package Descriptions

- **@flow/shared**: Zod schemas, TypeScript types, validation utilities
- **@flow/frontend**: React 18 + XYFlow canvas + Zustand state + Radix UI
- **@flow/transpiler**: YAML parsing, topology analysis, transpilation strategies

# Key Domains/Features

- Flow Canvas (trigger, condition, action, delay, wait nodes)
- YAML Parsing & Transpilation (YamlParser, FlowTranspiler)
- Home Assistant Integration (WebSocket API, entity/device/service registry)
- Simulation & Trace Visualization
- Property Editing Panels

# Build System & Tooling

- Yarn 4 workspaces + Turbo for orchestration
- TypeScript 5.7 with strict mode
- Vite for frontend builds
- Vitest for testing, make sure to use the --run flag to avoid issues with watch mode
- Biome for linting, and for formatting

# Coding Conventions

In addition to strict TypeScript rules:

- **Zod for Schema Validation**: All data structures use Zod schemas in `@flow/shared`
- **Zustand for State**: Single cohesive store pattern in `flow-store.ts`
- **React Patterns**: Use `memo()` for nodes, `cn()` for class merging, and typed NodeProps
- **Import Aliases**: `@/` for frontend, `@flow/*` for packages

# Common Commands

```bash
yarn dev                 # Watch mode
yarn build               # Build all packages
yarn build:ha            # Build + copy to custom_components
yarn test                # Run tests
yarn test:roundtrip      # Round-trip fixtures: HA configs must open and save with the same meaning
yarn typecheck           # Type checking
yarn lint:biome          # Linting
yarn release:bump 1.0.1  # Put a release version into every file that carries it
yarn release:check       # Fail unless those files agree
```

# Development Guidelines

## Release and Commit Policy

**IMPORTANT**: Never cut a new release or commit changes without first asking the user for permission.

Always ask before:

- Creating git commits
- Pushing changes to the repository
- Bumping version numbers
- Creating new releases/tags
- Running any git operations that modify the repository

The user should have full control over when changes are committed and released.

## TypeScript Code Quality

**STRICT TYPING REQUIRED**: Always maintain strict TypeScript types throughout the codebase.

**FORBIDDEN PRACTICES**:

- Never use `as` type assertions unless absolutely necessary for external API boundaries
- Never use `any` type - use proper type definitions or `unknown` with type guards
- Avoid type casting hacks or workarounds
- Don't suppress TypeScript errors with `@ts-ignore` or `@ts-expect-error`

**REQUIRED PRACTICES**:

- Define proper interfaces and types for all data structures
- Use type guards for runtime type checking
- Leverage TypeScript's strict mode features
- Create proper type definitions for external libraries if needed
- Use generic types appropriately for reusable components

The codebase should compile with zero TypeScript errors and maintain type safety throughout.

# Best Practices

## Code Reusability (DRY) - VITAL AND MANDATORY

**⚠️ THIS IS A NON-NEGOTIABLE REQUIREMENT ⚠️**

**ZERO TOLERANCE FOR CODE DUPLICATION.** Every single piece of duplicated code is a violation of this project's core principles. Before writing ANY code, you MUST check if similar logic already exists and reuse it.

**MANDATORY PRACTICES**:

- **Helper Functions/Utilities**: Extract common logic into reusable helper functions or utility modules. If you write the same logic twice, you have failed.
- **Generic Components**: Design React components to be as generic and reusable as possible, accepting props to customize behavior and appearance. Components MUST be designed for reuse from the start.
- **Shared Types/Schemas**: Leverage `@flow/shared` for all common types, interfaces, and Zod schemas to ensure consistency and avoid duplication across `frontend` and `transpiler`.
- **Custom Hooks**: For shared stateful logic in React, create custom hooks. ANY repeated stateful pattern MUST become a hook.
- **Before Writing Code**: ALWAYS search the codebase first to check if similar functionality exists. Reuse and extend existing code rather than creating new duplicates.
- **Refactor Immediately**: If you discover existing duplication while working, refactor it into a shared abstraction before proceeding.

**ABSOLUTELY FORBIDDEN - VIOLATIONS WILL NOT BE ACCEPTED**:

- **Copy-pasting code**: NEVER duplicate blocks of code under any circumstances. If you find yourself copying and pasting, STOP and create a reusable function, component, or hook instead.
- **Redundant Type Definitions**: NEVER redefine types or interfaces that already exist in `@flow/shared` or can be derived from existing schemas.
- **Similar but slightly different implementations**: If two pieces of code do similar things, they MUST be unified into a single parameterized implementation.
- **Duplicated constants or configuration**: All shared values MUST be defined once and imported where needed.
- **Repeated UI patterns**: Any UI pattern used more than once MUST be extracted into a reusable component.

**THE RULE IS SIMPLE: If code appears more than once, it's wrong. No exceptions.**

# Cutting a New Release

A release is a git tag. `scripts/bump-version.mjs` puts the version into every file that carries it, and `.github/workflows/release.yml` builds, publishes and verifies everything once the tag is pushed.

**Important:** A release `X.Y.Z` must carry the same version in `custom_components/flow/manifest.json` (HACS), `flow_web/config.yaml` and the `ARG BUILD_VERSION` line of `flow_web/Dockerfile` (the Home Assistant add-on), and be tagged `vX.Y.Z`. Never edit those by hand: use the bump script. The release workflow stops if they disagree.

**All information for the release (version number and release notes) must be automatically derived from the git commit history since the last release.**

- The version number should be determined based on semantic versioning and recent changes. A pre-release looks like `1.5.0-rc.1`: GitHub marks it as a pre-release and the `latest` image is left alone.
- The release notes are generated by the workflow (`scripts/release-notes.mjs`) from the conventional-commit subjects since the previous stable tag, grouped into breaking changes, features, fixes and other changes. Do NOT create a literal CHANGELOG.md file for them and do not write them by hand; write clear commit subjects instead (`feat(scope): ...`, `fix(scope): ...`).
- The one exception is `flow_web/CHANGELOG.md`: Home Assistant shows it as the add-on's changelog, and it is short and written by hand. Add a `## X.Y.Z` entry to it in the release commit.

1. **Bump the version**

- Example:
  ```bash
  yarn release:bump 1.4.0   # edits the three files above
  yarn release:check        # optional: confirms they agree
  ```

2. **Commit**

- Commit the three version files and the add-on changelog entry with a message like `chore(release): v1.4.0`.
- Example:
  ```bash
  git add custom_components/flow/manifest.json flow_web/config.yaml flow_web/Dockerfile flow_web/CHANGELOG.md
  git commit -m "chore(release): v1.4.0"
  ```

3. **Tag and push**

- Use the version of the bump with a `v` in front (e.g., v1.4.0).
- Example:
  ```bash
  git tag v1.4.0
  git push origin main v1.4.0
  ```

4. **The workflow does the rest**

- The tag push starts the Release workflow. It checks the three versions against the tag, runs CI, builds `flow.zip` and `flow.tar.gz`, creates the GitHub Release with the generated notes, and pushes `ghcr.io/nphil/flow:1.4.0` (and `latest` for a stable version).
- HACS picks the release up on its own (`hacs.json` points at `flow.zip`), and the add-on's Dockerfile downloads the `flow.tar.gz` of its own version. Nothing else needs touching.
- A release created by hand in the GitHub UI works too: the workflow attaches the files and leaves its title and notes alone.
- To rehearse without publishing anything, run the workflow by hand. `dry_run` is on by default and the files stay a workflow artifact:
  ```bash
  gh workflow run release.yml --ref <branch> -f version=1.4.0
  ```
- If a release fails half way, re-run the workflow run in GitHub. It replaces the files of the existing release instead of failing.

5. **Verify release on GitHub**

- Watch the run with `gh run watch`.
- Check the Releases page: the new release must list `flow.zip` and `flow.tar.gz`.

**Note:** Do not cut a release without explicit user approval. Always confirm before bumping versions, committing, pushing tags or creating releases.
