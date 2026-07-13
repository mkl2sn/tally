# tally Development Guide

## General guidelines

- Avoid em-dashes and emojis like the plague
- ALWAYS write in english: code, variables, comments, branches, commits, PRs etc.

## Commits and Pull Requests

- Use [conventional commits](https://www.conventionalcommits.org/en/v1.0.0/) for all commit messages and PR titles.

### Commit types

- `feat`: New feature or functionality (touches production code)
- `fix`: Bug fix (touches production code)
- `chore`: Non-production changes (docs, tests, config, CI, refactoring agents instructions, etc.)

### Format

```text
<type>(<scope>): <description>
```

Examples:

- `feat(insights): add retention graph export`
- `fix(cohorts): handle empty cohort in query builder`
- `chore(ci): update GitHub Actions workflow`
- `chore: update AGENTS.md instructions`

## Code Style

- CSS: Use tailwind utility classes instead of inline styles
- Error handling: Prefer explicit error handling with typed errors

## Frontend architecture

- Keep SvelteKit route components focused on orchestration.
- Colocate route-specific components with their route.
- Move code into `$lib` only when it has multiple real consumers.
- Keep server-only code in `+*.server.ts` or `$lib/server`.
- Prefer pure functions and `$derived` over state synchronization with `$effect`.
- Do not add production dependencies during refactors.
- Refactor large components in behavior-preserving, reviewable stages.
- Run formatting, linting, Svelte checks, tests, and the production build.
