/** Forward analytics requests without exposing application credentials. */
export async function proxyPostHogRequest(request: Request): Promise<Response> {
	const url = new URL(request.url);
	const useAssetHost =
		url.pathname.startsWith('/ingest/static/') || url.pathname.startsWith('/ingest/array/');
	url.protocol = 'https:';
	url.hostname = useAssetHost ? 'eu-assets.i.posthog.com' : 'eu.i.posthog.com';
	url.port = '443';
	url.pathname = url.pathname.replace(/^\/ingest/, '');

	const headers = new Headers();
	for (const name of ['accept', 'content-type', 'content-encoding', 'user-agent']) {
		const value = request.headers.get(name);
		if (value !== null) headers.set(name, value);
	}
	return fetch(url.toString(), {
		method: request.method,
		headers,
		body: request.body,
		// @ts-expect-error - duplex is required for streaming request bodies
		duplex: 'half'
	});
}
