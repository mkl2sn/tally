import { PING_INTERVAL_MS } from '$lib/protocol';
import type { ClientMessage, Role, RoomSnapshot, ServerMessage } from '$lib/protocol';

export type ConnectionStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

export interface StoredSession {
	playerId?: string;
	secret?: string;
	role?: Role;
}

const sessionKey = (roomId: string) => `tally:room:${roomId}`;

export function storedSession(roomId: string): StoredSession {
	try {
		return JSON.parse(localStorage.getItem(sessionKey(roomId)) ?? '{}');
	} catch {
		return {};
	}
}

export class RoomConnection {
	snapshot = $state<RoomSnapshot | null>(null);
	status = $state<ConnectionStatus>('connecting');
	closeReason = $state<string | null>(null);

	private ws: WebSocket | null = null;
	private attempts = 0;
	private destroyed = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private pingWorker: Worker | null = null;

	constructor(
		private roomId: string,
		private profile: { name: string; role: Role }
	) {
		this.connect();
		// A closed tab never runs onDestroy, so signal a clean leave here: this
		// fires the close frame the server needs to mark us offline right away.
		window.addEventListener('pagehide', this.destroy);
		// Heartbeat so the server can tell a dead socket from a quiet one. It
		// runs in a worker because timers in hidden tabs are throttled to once
		// a minute, which would trip the server's heartbeat timeout.
		const src = `setInterval(() => postMessage(0), ${PING_INTERVAL_MS})`;
		this.pingWorker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
		this.pingWorker.addEventListener('message', () => this.send({ type: 'ping' }));
	}

	private connect() {
		if (this.destroyed) return;
		const proto = location.protocol === 'https:' ? 'wss' : 'ws';
		const ws = new WebSocket(`${proto}://${location.host}/ws/${this.roomId}`);
		this.ws = ws;

		ws.addEventListener('open', () => {
			this.attempts = 0;
			const { playerId, secret } = storedSession(this.roomId);
			this.send({
				type: 'join',
				name: this.profile.name,
				role: this.profile.role,
				playerId,
				secret
			});
		});

		ws.addEventListener('message', (event) => {
			let msg: ServerMessage;
			try {
				msg = JSON.parse(event.data as string);
			} catch {
				return;
			}
			if (msg.type === 'joined') {
				this.persistSession({ playerId: msg.playerId, secret: msg.secret });
				this.status = 'open';
			} else if (msg.type === 'state') {
				this.snapshot = msg.state;
				this.status = 'open';
			} else if (msg.type === 'error') {
				this.closeReason = msg.message;
			}
		});

		ws.addEventListener('close', (event) => {
			if (this.destroyed) return;
			if (event.code === 1008 || event.code === 1001) {
				// Rejected (room full) or room expired: don't hammer the server.
				this.closeReason ??= event.reason || 'Connection closed.';
				this.status = 'closed';
				return;
			}
			this.status = 'reconnecting';
			const delay = Math.min(500 * 2 ** this.attempts++, 8000);
			this.reconnectTimer = setTimeout(() => this.connect(), delay);
		});
	}

	private persistSession(patch: Partial<StoredSession>) {
		localStorage.setItem(
			sessionKey(this.roomId),
			JSON.stringify({ ...storedSession(this.roomId), role: this.profile.role, ...patch })
		);
	}

	send(msg: ClientMessage) {
		if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
	}

	vote(card: string | null) {
		this.send({ type: 'vote', card });
	}

	setRole(role: Role) {
		this.profile.role = role;
		this.persistSession({ role });
		this.send({ type: 'setRole', role });
	}

	rename(name: string) {
		this.profile.name = name;
		localStorage.setItem('tally:name', name);
		this.send({ type: 'rename', name });
	}

	destroy = () => {
		this.destroyed = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		window.removeEventListener('pagehide', this.destroy);
		this.pingWorker?.terminate();
		this.pingWorker = null;
		this.ws?.close();
	};
}
