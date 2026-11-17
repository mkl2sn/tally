# Tally

Real-time planning poker on Cloudflare. Create a game, share the link, and estimate
together without accounts. Choose a preset or custom deck, join as a player or
spectator, and review results and voting history.

![Tally demo room with six players and revealed estimates](docs/images/tally-demo.png)

## Develop

Use Node.js 24 (the version used in CI) and pnpm 10.34.4 (pinned in
[package.json](package.json)). From the repository root:

```sh
pnpm install --frozen-lockfile
cp .env.example .env
pnpm gen
pnpm dev:full
```

Open `http://localhost:8787`. `pnpm dev:full` builds the app and starts the full
Cloudflare Worker locally, including room creation and WebSockets. Re-run it after
code changes to rebuild.

For UI work with Vite hot reload, use `pnpm dev`. This does not run the Durable
Object, so room creation and WebSockets are unavailable. To preview an existing
build on port 4173, run `pnpm preview` after `pnpm build`.

`worker-configuration.d.ts` is generated and ignored by Git. Run `pnpm gen` after
changing [wrangler.jsonc](wrangler.jsonc); `pnpm check` and `pnpm build` also
regenerate these types.

Keep the variables from [.env.example](.env.example) in `.env`, even when analytics
is disabled. SvelteKit imports them at build time, so missing variables can prevent
checks and builds from completing.

## Checks and tests

Run the standard checks before submitting changes:

```sh
pnpm format
pnpm lint
pnpm check
pnpm test
pnpm build
```

| Command           | Purpose                                                         |
| ----------------- | --------------------------------------------------------------- |
| `pnpm format`     | Format files with oxfmt, including Tailwind class sorting       |
| `pnpm lint`       | Run oxlint and check formatting with oxfmt                      |
| `pnpm check`      | Generate Worker types, sync SvelteKit, and run svelte-check     |
| `pnpm test`       | Run Vitest unit and Durable Object integration tests in workerd |
| `pnpm test:watch` | Run Vitest in watch mode                                        |
| `pnpm test:smoke` | Check room creation and error recovery against the built Worker |
| `pnpm test:e2e`   | Run Playwright browser tests against the built Worker           |

Smoke and browser tests require a prior build. Install Chromium before the first
browser test run:

```sh
pnpm build
pnpm test:smoke
pnpm exec playwright install chromium
pnpm test:e2e
```

The smoke and browser test runners start Wrangler automatically on ports 8788 and
8789, respectively. On Linux, use `pnpm exec playwright install --with-deps chromium`
to install browser system dependencies as well.

See [the browser room joining regression](docs/browser-room-joining.md) for details
of the delayed-hydration regression coverage.

## Architecture

- **SvelteKit with Svelte 5 runes and Tailwind CSS v4** runs as a single Cloudflare
  Worker with static assets.
- **Durable Objects** provide real-time rooms. Each room has one `PokerRoom` using
  the WebSocket Hibernation API. Room state and voting history persist in Durable
  Object storage; rooms expire after 30 days of inactivity.
- [src/worker.ts](src/worker.ts) is the Worker entry point. It routes `/ws/:roomId`
  upgrades to the room's Durable Object and delegates other requests to SvelteKit.
- [wrangler.build.jsonc](wrangler.build.jsonc) configures the SvelteKit adapter's
  generated Worker separately from the deployment entry point. The
  `sveltekit-worker` alias in `wrangler.jsonc` connects the two.
- [src/lib/protocol.ts](src/lib/protocol.ts) defines shared client/server messages.
  The room issues a player ID and secret, which the client saves in localStorage
  to reconnect with the same identity.
- Server-only room and analytics code lives in `src/lib/server`; routes live in
  `src/routes`.

## Analytics

PostHog is disabled by default in `.env.example`. To enable it locally, set
`PUBLIC_POSTHOG_ENABLED=true` and replace `PUBLIC_POSTHOG_PROJECT_TOKEN` with your
project token. `PUBLIC_POSTHOG_HOST` defaults to `https://eu.i.posthog.com`.
Rebuild after changing these values because they are embedded at build time.

The current integration targets PostHog's EU region: browser requests go through
`/ingest`, whose proxy uses the EU ingestion and asset hosts. The browser UI host
is also set to the EU region. Changing `PUBLIC_POSTHOG_HOST` alone only changes the
server event destination.

## Deploy

Pushes to `main` and pull requests run checks, the production build, smoke tests,
and browser tests. Deployment is manual: in GitHub, open **Actions > CI > Run
workflow**, select `main`, and run the workflow. Deployment runs only after checks
pass.

Configure these repository secrets for deployment:

- `CLOUDFLARE_API_TOKEN`: a Cloudflare API token with Workers Scripts:Edit permission.
- `CLOUDFLARE_ACCOUNT_ID`: the target Cloudflare account ID.

The deploy job enables analytics and reads `PUBLIC_POSTHOG_PROJECT_TOKEN` and
`PUBLIC_POSTHOG_HOST` from GitHub Actions repository variables. Set these before
deploying with analytics. The checks job keeps analytics disabled. See
[the CI workflow](.github/workflows/ci.yml) for the exact configuration.

To deploy locally with your Cloudflare credentials and local analytics settings:

```sh
pnpm build
pnpm exec wrangler deploy
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the contribution workflow and
[AGENTS.md](AGENTS.md) for repository conventions.

## License

Tally is licensed under the [MIT License](LICENSE). Third-party dependencies,
fonts, and icons retain their own licenses.
