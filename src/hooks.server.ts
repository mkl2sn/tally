import type { Handle, HandleServerError } from '@sveltejs/kit';
import { captureServerEvent } from '$lib/server/posthog';
import { proxyPostHogRequest } from '$lib/server/posthog-proxy';
import { PUBLIC_POSTHOG_ENABLED } from '$env/static/public';

export const handle: Handle = async ({ event, resolve }) => {
	const { pathname } = event.url;

	if (
		PUBLIC_POSTHOG_ENABLED === 'true' &&
		(pathname === '/ingest' || pathname.startsWith('/ingest/'))
	) {
		return proxyPostHogRequest(event.request);
	}

	return resolve(event);
};

export const handleError: HandleServerError = async ({ error, status, message, event }) => {
	captureServerEvent(event.platform?.ctx, {
		distinctId: 'server',
		event: 'server_error',
		properties: {
			error: error instanceof Error ? error.message : String(error),
			status,
			message
		}
	});

	return { message, status };
};
