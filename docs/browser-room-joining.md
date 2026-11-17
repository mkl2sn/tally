# Browser room joining regression

## Diagnosis

The original five Playwright scenarios reproduced one join failure out of five
against the built Worker. The previously reported three failures out of five vary
with hydration timing.

The failed trace showed Bob's name being filled and the join button clicked, but
the final page still displayed the join form with an empty name. All recorded
document and asset requests returned HTTP 200, with no WebSocket join attempt.
The server-rendered form accepted input before client hydration and the mount
callback restored the saved name. This could erase input before submission.

The join form now uses a disabled fieldset until hydration and stored-profile
restoration finish. This protects users on slow connections as well as automated
browser interactions. No sleeps, assertion relaxations, or WebSocket changes are
needed.

## Regression coverage

The delayed-hydration browser test holds JavaScript asset requests until it has
checked that the name field and submit button are disabled. It then releases the
assets and joins through the UI. It failed before the fix and passes afterward.
The original five scenarios retain their assertions.

Verification against the built Worker: `pnpm exec playwright test --repeat-each=10`
passed all 60 runs, covering the six scenarios ten times each.

For a checkout without a local `.env`, use the documented analytics configuration
when building or running Svelte checks:

```sh
PUBLIC_POSTHOG_ENABLED=false PUBLIC_POSTHOG_PROJECT_TOKEN='' PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com pnpm build
pnpm test:e2e
```

Without these variables, the build fails on missing static environment exports
before any browser scenario can run. This is separate from the hydration race.
