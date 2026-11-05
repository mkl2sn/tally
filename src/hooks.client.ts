import posthog from 'posthog-js';
import { PUBLIC_POSTHOG_PROJECT_TOKEN, PUBLIC_POSTHOG_ENABLED } from '$env/static/public';
import type { HandleClientError } from '@sveltejs/kit';

const posthogEnabled = PUBLIC_POSTHOG_ENABLED === 'true';

export async function init() {
	if (!posthogEnabled) return;

	posthog.init(PUBLIC_POSTHOG_PROJECT_TOKEN, {
		api_host: '/ingest',
		ui_host: 'https://eu.posthog.com',
		defaults: '2026-01-30',
		disable_surveys: true,
		capture_exceptions: true
	});
}

export const handleError: HandleClientError = async ({ error, status, message }) => {
	if (posthogEnabled) {
		posthog.captureException(error);
	}

	return { message, status };
};
