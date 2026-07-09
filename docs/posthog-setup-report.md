# PostHog post-wizard report

The wizard has completed a deep integration of PostHog analytics into Tally, a real-time planning poker app built with SvelteKit on Cloudflare Workers. The integration adds client-side tracking via `posthog-js`, a reverse proxy to bypass ad blockers, server-side tracking via `posthog-node` for the room creation API, and client-side error capture. Session replay is enabled and configured correctly (`paths.relative: false` added to `vite.config.ts`).

## Events instrumented

| Event name | Description | File |
|---|---|---|
| `game_created` | User creates a new planning poker game room from the home page. | `src/routes/+page.svelte` |
| `game_joined` | User joins an existing game room by submitting their name on the join screen. | `src/routes/room/[id]/+page.svelte` |
| `vote_cast` | Player selects a card to cast their vote during a voting round. | `src/routes/room/[id]/+page.svelte` |
| `cards_revealed` | Cards are revealed to all players, ending the current voting phase. | `src/routes/room/[id]/+page.svelte` |
| `new_round_started` | A new voting round is started after cards have been revealed. | `src/routes/room/[id]/+page.svelte` |
| `invite_link_copied` | User copies the room invite link to share with teammates. | `src/routes/room/[id]/+page.svelte` |
| `room_created` | Server-side: a new poker room is successfully initialized via the API. | `src/routes/api/rooms/+server.ts` |

## Files created or modified

- **`vite.config.ts`** — added `paths: { relative: false }` to enable session replay with SSR
- **`src/hooks.client.ts`** _(new)_ — initializes `posthog-js`, wires up `handleError` for client-side exception capture
- **`src/hooks.server.ts`** _(new)_ — reverse proxy at `/ingest` to route PostHog traffic, wires up `handleError` for server-side error tracking
- **`src/lib/server/posthog.ts`** _(new)_ — singleton `getPostHogClient()` using `posthog-node` with `flushAt: 1` / `flushInterval: 0` for Cloudflare Workers
- **`src/routes/+page.svelte`** — captures `game_created` on successful room creation
- **`src/routes/room/[id]/+page.svelte`** — captures `game_joined`, `vote_cast`, `invite_link_copied`, `cards_revealed`, `new_round_started`
- **`src/routes/api/rooms/+server.ts`** — captures `room_created` server-side with flush
- **`package.json`** — added `posthog-js` and `posthog-node` as dependencies
- **`.env`** — added `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST`

## Next steps

We've built a dashboard and insights to keep an eye on user behavior:

- **Dashboard:** [Analytics basics (wizard)](https://eu.posthog.com/project/219301/dashboard/805104)
- [Games created over time](https://eu.posthog.com/project/219301/insights/snGwOF9K)
- [Planning poker session funnel](https://eu.posthog.com/project/219301/insights/n7OfRO2D) — game created → joined → voted → revealed
- [Player join role breakdown](https://eu.posthog.com/project/219301/insights/upSHntjd) — player vs spectator split
- [Rounds completed per day](https://eu.posthog.com/project/219301/insights/btEaBS7d)
- [Invite link sharing](https://eu.posthog.com/project/219301/insights/S2oP61w8)

## Verify before merging

- [ ] Run `pnpm install` to install `posthog-js` and `posthog-node` (network was unavailable during setup, so packages were added to `package.json` but not fetched).
- [ ] Run a full production build (`pnpm build`) and fix any lint or type errors introduced by the generated code.
- [ ] Run the test suite — call sites that were rewritten or instrumented may need updated mocks or fixtures.
- [ ] Add `PUBLIC_POSTHOG_PROJECT_TOKEN` and `PUBLIC_POSTHOG_HOST` to `.env.example` and any onboarding docs so collaborators know what to set.
- [ ] Wire source-map upload (`posthog-cli sourcemap` or your bundler's upload step) into CI so production stack traces de-minify in PostHog error tracking.

### Agent skill

We've left an agent skill folder in your project. You can use this context for further agent development when using Claude Code. This will help ensure the model provides the most up-to-date approaches for integrating PostHog.
