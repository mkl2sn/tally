import { defineConfig, devices } from '@playwright/test';

// E2E tests run against the built worker in real workerd.
// Requires a prior `pnpm build`.
export default defineConfig({
	testDir: 'e2e',
	fullyParallel: true,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	use: {
		baseURL: 'http://127.0.0.1:8789',
		trace: 'retain-on-failure'
	},
	projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
	webServer: {
		command: 'pnpm exec wrangler dev --port 8789',
		url: 'http://127.0.0.1:8789',
		reuseExistingServer: !process.env.CI,
		timeout: 60_000
	}
});
