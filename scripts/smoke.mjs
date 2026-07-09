// Smoke test against the built worker in real workerd (wrangler dev).
// Catches runtime-only failures that Node-based unit tests cannot see,
// e.g. cross-request I/O hangs. Requires a prior `pnpm build`.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';

const PORT = 8788;
const BASE = `http://127.0.0.1:${PORT}`;
const REQUEST_TIMEOUT_MS = 5000;

if (!existsSync('.svelte-kit/cloudflare/_worker.js')) {
	console.error('Build output missing - run `pnpm build` first.');
	process.exit(1);
}

const wrangler = spawn('pnpm', ['exec', 'wrangler', 'dev', '--port', String(PORT)], {
	detached: true,
	stdio: ['ignore', 'pipe', 'pipe']
});
let serverLog = '';
let serverExited = false;
wrangler.stdout.on('data', (d) => (serverLog += d));
wrangler.stderr.on('data', (d) => (serverLog += d));
wrangler.on('exit', () => (serverExited = true));

const get = (path) => fetch(BASE + path, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
const createRoom = () =>
	fetch(`${BASE}/api/rooms`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ roomName: 'Smoke', deck: ['1', '2', '3'] }),
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});

async function waitForServer() {
	for (let i = 0; i < 60; i++) {
		if (serverExited) throw new Error('wrangler dev exited before becoming ready');
		try {
			if ((await get('/')).ok) return;
		} catch {
			// not up yet, keep polling
		}
		await new Promise((resolve) => setTimeout(resolve, 1000));
	}
	throw new Error('wrangler dev did not become ready within 60s');
}

async function check(label, expectedStatus, fn) {
	const res = await fn().catch((e) => {
		throw new Error(`${label}: request hung or failed (${e.message})`);
	});
	if (res.status !== expectedStatus) {
		throw new Error(`${label}: expected ${expectedStatus}, got ${res.status}`);
	}
	return res;
}

try {
	await waitForServer();

	// happy path: create a room, its page resolves
	const res = await check('create room', 200, createRoom);
	const { roomId } = await res.json();
	await check('room page', 200, () => get(`/room/${roomId}`));

	// regression: a 404 (handleError -> analytics capture) must not break later requests
	await check('404 page', 404, () => get('/smoke-test-missing-page'));
	await check('create room after 404', 200, createRoom);

	console.log('smoke: all checks passed');
} catch (e) {
	console.error(`smoke: FAILED - ${e.message}`);
	console.error('--- wrangler output (tail) ---');
	console.error(serverLog.split('\n').slice(-30).join('\n'));
	process.exitCode = 1;
} finally {
	try {
		process.kill(-wrangler.pid, 'SIGTERM');
	} catch {
		// already gone
	}
}
