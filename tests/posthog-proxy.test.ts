import { afterEach, describe, expect, it, vi } from 'vitest';
import { proxyPostHogRequest } from '../src/lib/server/posthog-proxy';

afterEach(() => vi.unstubAllGlobals());

describe('PostHog proxy', () => {
	it('forwards analytics payloads without application credentials or client IP headers', async () => {
		const upstream = new Response('accepted', { status: 202 });
		const fetchMock = vi.fn().mockResolvedValue(upstream);
		vi.stubGlobal('fetch', fetchMock);
		const response = await proxyPostHogRequest(
			new Request('https://tally.example/ingest/e/?v=1', {
				method: 'POST',
				headers: {
					'content-type': 'application/json',
					cookie: 'session=dummy',
					authorization: 'Bearer dummy',
					'x-forwarded-for': '192.0.2.1',
					'cf-connecting-ip': '192.0.2.1',
					'x-custom-secret': 'dummy'
				},
				body: '{"event":"game_created"}'
			})
		);
		expect(response).toBe(upstream);
		const [url, options] = fetchMock.mock.calls[0];
		expect(url).toBe('https://eu.i.posthog.com/e/?v=1');
		expect(options.method).toBe('POST');
		expect([...options.headers.entries()]).toEqual([['content-type', 'application/json']]);
		expect(await new Response(options.body).text()).toBe('{"event":"game_created"}');
	});

	it.each(['/static/array.js', '/array/config.js'])(
		'routes SDK assets to the fixed asset host: %s',
		async (path) => {
			const fetchMock = vi.fn().mockResolvedValue(new Response('script'));
			vi.stubGlobal('fetch', fetchMock);
			await proxyPostHogRequest(new Request(`https://tally.example/ingest${path}`));
			expect(fetchMock.mock.calls[0][0]).toBe(`https://eu-assets.i.posthog.com${path}`);
		}
	);
});
