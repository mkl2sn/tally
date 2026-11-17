# Contributing

See [README.md](README.md#develop) for local setup and [AGENTS.md](AGENTS.md) for coding conventions.

- Keep changes focused and write code, comments, commits, and pull requests in English.
- Add or update tests when changing behavior.
- Use Conventional Commits for commit messages and PR titles: `feat(scope): description`, `fix(scope): description`, or `chore(scope): description`.
- Describe what changed, why, and how you tested it in your pull request.

Before submitting, run:

```sh
pnpm format
pnpm lint
pnpm check
pnpm test
pnpm build
```
