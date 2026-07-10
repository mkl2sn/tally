import { PostHog } from 'posthog-node';
import {
	PUBLIC_POSTHOG_PROJECT_TOKEN,
	PUBLIC_POSTHOG_HOST,
	PUBLIC_POSTHOG_ENABLED
} from '$env/static/public';

/**
 * Fire-and-forget server event. Uses a fresh client per call: a shared client
 * keeps pending I/O across requests, which workerd forbids — a later flush()
 * then hangs forever waiting on a promise from a dead request context.
 */
export function captureServerEvent(
	ctx: { waitUntil(promise: Promise<unknown>): void } | undefined,
	event: Parameters<PostHog['capture']>[0]
) {
	if (PUBLIC_POSTHOG_ENABLED !== 'true') return;

	const posthog = new PostHog(PUBLIC_POSTHOG_PROJECT_TOKEN, {
		host: PUBLIC_POSTHOG_HOST,
		flushAt: 1,
		flushInterval: 0
	});
	posthog.capture(event);
	ctx?.waitUntil(posthog.shutdown());
}
