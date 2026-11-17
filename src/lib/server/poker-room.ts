import { DurableObject } from 'cloudflare:workers';
import {
	HEARTBEAT_TIMEOUT_MS,
	MAX_NAME_LENGTH,
	MAX_ROOM_NAME_LENGTH,
	REVEAL_COUNTDOWN_MS,
	sanitizeDeck,
	type ClientMessage,
	type ServerMessage,
	type RoomSnapshot,
	type PlayerView,
	type RoundResult,
	type HistoryEntry,
	type TimerState,
	type Phase,
	type Role,
	type WhoCanReveal
} from '../protocol';
import { computeRoundResult } from '../scoring';
import { parseClientMessage } from './client-message';

const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;
const HISTORY_LIMIT = 50;
const STALE_PLAYER_MS = 24 * 60 * 60 * 1000;
const MAX_PLAYERS = 50;

export interface RoomConfig {
	roomName: string;
	deck: string[];
	autoReveal: boolean;
	revealCountdown: boolean;
	whoCanReveal: WhoCanReveal;
	showAverage: boolean;
	/** False once the room has been opened: no moderator, everyone manages. Irreversible. */
	moderated: boolean;
	createdAt: number;
}

interface StoredPlayer {
	id: string;
	name: string;
	role: Role;
	joinedAt: number;
	secret: string;
	lastSeen: number;
}

interface RoundState {
	n: number;
	phase: Phase;
	votes: Record<string, string>;
	countdownEndsAt: number | null;
	result: RoundResult | null;
}

const freshRound = (n: number): RoundState => ({
	n,
	phase: 'voting',
	votes: {},
	countdownEndsAt: null,
	result: null
});

export class PokerRoom extends DurableObject<Env> {
	private loaded = false;
	private config: RoomConfig | null = null;
	private players = new Map<string, StoredPlayer>();
	private round: RoundState = freshRound(1);
	private history: HistoryEntry[] = [];
	private moderatorId: string | null = null;
	private timer: TimerState | null = null;
	private bannedIds: string[] = [];
	/**
	 * Last message time per socket, in memory only. A killed tab or dropped
	 * network never sends a close frame, so the runtime keeps the socket
	 * "open" indefinitely; this map is what lets us call it dead. Lost on
	 * eviction, but an unknown socket just gets a fresh 30s clock.
	 */
	private lastPing = new Map<WebSocket, number>();

	private async load() {
		if (this.loaded) return;
		const data = await this.ctx.storage.get([
			'config',
			'players',
			'round',
			'history',
			'moderatorId',
			'timer',
			'banned'
		]);
		this.config = (data.get('config') as RoomConfig) ?? null;
		if (this.config) {
			this.config.whoCanReveal ??= 'all';
			this.config.showAverage ??= true;
			this.config.moderated ??= true;
		}
		this.players = new Map(
			Object.entries((data.get('players') as Record<string, StoredPlayer>) ?? {})
		);
		this.round = (data.get('round') as RoundState) ?? freshRound(1);
		this.history = (data.get('history') as HistoryEntry[]) ?? [];
		this.moderatorId = (data.get('moderatorId') as string) ?? null;
		this.timer = (data.get('timer') as TimerState) ?? null;
		this.bannedIds = (data.get('banned') as string[]) ?? [];
		this.loaded = true;
	}

	/** Called via RPC from the room creation endpoint. Idempotent. */
	async init(
		config: Omit<RoomConfig, 'createdAt' | 'whoCanReveal' | 'showAverage' | 'moderated'> &
			Partial<Pick<RoomConfig, 'whoCanReveal' | 'showAverage' | 'moderated'>>
	) {
		await this.load();
		if (this.config) return;
		this.config = {
			whoCanReveal: 'all',
			showAverage: true,
			moderated: false,
			...config,
			createdAt: Date.now()
		};
		await this.ctx.storage.put('config', this.config);
		await this.touch();
	}

	/** Called via RPC from the room page load. */
	async roomInfo(): Promise<{ roomName: string } | null> {
		await this.load();
		return this.config ? { roomName: this.config.roomName } : null;
	}

	async fetch(request: Request): Promise<Response> {
		await this.load();
		if (!this.config) return new Response('Room not found', { status: 404 });
		if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
			return new Response('Expected WebSocket', { status: 426 });
		}
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server);
		this.lastPing.set(server, Date.now());
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer) {
		await this.load();
		if (!this.config) return;
		const msg = parseClientMessage(raw);
		if (!msg) return;

		this.lastPing.set(ws, Date.now());
		if (msg.type === 'ping') {
			await this.closeDeadSockets();
			return;
		}

		if (msg.type === 'join') {
			await this.handleJoin(ws, msg);
			await this.touch();
			return;
		}

		const playerId = (ws.deserializeAttachment() as { playerId: string } | null)?.playerId;
		const player = playerId ? this.players.get(playerId) : undefined;
		if (!player) return;

		switch (msg.type) {
			case 'vote': {
				if (player.role !== 'player' || this.round.phase !== 'voting') return;
				if (msg.card === null) delete this.round.votes[player.id];
				else if (this.config.deck.includes(msg.card)) this.round.votes[player.id] = msg.card;
				else return;
				await this.persistRound();
				await this.checkAutoReveal();
				break;
			}
			case 'reveal': {
				if (!this.canReveal(player)) return;
				await this.startReveal();
				break;
			}
			case 'newRound': {
				if (!this.canManage(player) || this.round.phase === 'countdown') return;
				this.round = freshRound(this.round.n + 1);
				this.timer = null;
				await this.ctx.storage.put({ round: this.round, timer: this.timer });
				break;
			}
			case 'setRole': {
				if (msg.role !== 'player' && msg.role !== 'spectator') return;
				player.role = msg.role;
				if (msg.role === 'spectator') delete this.round.votes[player.id];
				await this.persistPlayers();
				await this.persistRound();
				await this.checkAutoReveal();
				break;
			}
			case 'rename': {
				const name = sanitizeName(msg.name);
				if (!name) return;
				player.name = name;
				await this.persistPlayers();
				break;
			}
			case 'setRoomName': {
				if (!this.canManage(player)) return;
				const name =
					typeof msg.name === 'string' ? msg.name.trim().slice(0, MAX_ROOM_NAME_LENGTH) : '';
				if (!name) return;
				this.config.roomName = name;
				await this.ctx.storage.put('config', this.config);
				break;
			}
			case 'setDeck': {
				if (!this.canManage(player)) return;
				const deck = sanitizeDeck(msg.deck);
				if (deck.length < 2) return;
				this.config.deck = deck;
				await this.ctx.storage.put('config', this.config);
				if (this.round.phase === 'voting') {
					for (const [id, card] of Object.entries(this.round.votes)) {
						if (!deck.includes(card)) delete this.round.votes[id];
					}
					await this.persistRound();
					await this.checkAutoReveal();
				}
				break;
			}
			case 'setAutoReveal': {
				if (!this.canManage(player)) return;
				this.config.autoReveal = msg.value === true;
				await this.ctx.storage.put('config', this.config);
				await this.checkAutoReveal();
				break;
			}
			case 'setRevealCountdown': {
				if (!this.canManage(player)) return;
				this.config.revealCountdown = msg.value === true;
				await this.ctx.storage.put('config', this.config);
				break;
			}
			case 'setShowAverage': {
				if (!this.canManage(player)) return;
				this.config.showAverage = msg.value === true;
				await this.ctx.storage.put('config', this.config);
				break;
			}
			case 'setWhoCanReveal': {
				if (!this.canManage(player)) return;
				if (msg.value === 'all' || msg.value === 'moderator') {
					this.config.whoCanReveal = msg.value;
				} else if (Array.isArray(msg.value)) {
					this.config.whoCanReveal = msg.value.filter(
						(id) => typeof id === 'string' && this.players.has(id)
					);
				} else return;
				await this.ctx.storage.put('config', this.config);
				break;
			}
			case 'transferModerator': {
				if (!this.isModerator(player) || !this.players.has(msg.playerId)) return;
				this.moderatorId = msg.playerId;
				await this.ctx.storage.put('moderatorId', this.moderatorId);
				break;
			}
			case 'kick': {
				// Moderator-only, and only in a moderated room. Open rooms have no moderator.
				if (!this.config.moderated || !this.isModerator(player)) return;
				if (msg.playerId === player.id || !this.players.has(msg.playerId)) return;
				this.players.delete(msg.playerId);
				delete this.round.votes[msg.playerId];
				if (!this.bannedIds.includes(msg.playerId)) this.bannedIds.push(msg.playerId);
				await this.ctx.storage.put({
					players: Object.fromEntries(this.players),
					round: this.round,
					banned: this.bannedIds
				});
				for (const sock of this.ctx.getWebSockets()) {
					const att = sock.deserializeAttachment() as { playerId: string } | null;
					if (att?.playerId === msg.playerId) {
						this.send(sock, {
							type: 'error',
							message: 'The moderator removed you from this game.'
						});
						sock.close(1008, 'Removed from game');
					}
				}
				break;
			}
			case 'claimModerator': {
				if (!this.config.moderated) return;
				if (this.moderatorId && this.onlineIds().has(this.moderatorId)) return;
				this.moderatorId = player.id;
				await this.ctx.storage.put('moderatorId', this.moderatorId);
				break;
			}
			case 'openRoom': {
				// One-way: an open room stays open forever.
				if (!this.config.moderated || !this.isModerator(player)) return;
				this.config.moderated = false;
				this.moderatorId = null;
				await this.ctx.storage.put('config', this.config);
				await this.ctx.storage.delete('moderatorId');
				break;
			}
			case 'startTimer': {
				if (!this.canManage(player)) return;
				const seconds = Math.min(3600, Math.max(10, Math.floor(msg.seconds)));
				this.timer = {
					endsAt: Date.now() + seconds * 1000,
					duration: seconds,
					initialDuration: seconds
				};
				await this.ctx.storage.put('timer', this.timer);
				break;
			}
			case 'adjustTimer': {
				if (!this.config.moderated || !this.isModerator(player) || !this.timer) return;
				const now = Date.now();
				const expired = this.timer.endsAt <= now;
				this.timer = {
					initialDuration: this.timer.initialDuration ?? this.timer.duration,
					endsAt: Math.max(
						now,
						Math.min(now + 3_600_000, Math.max(now, this.timer.endsAt) + msg.seconds * 1000)
					),
					duration: Math.max(1, Math.min(3600, (expired ? 0 : this.timer.duration) + msg.seconds))
				};
				await this.ctx.storage.put('timer', this.timer);
				break;
			}
			case 'stopTimer': {
				if (!this.canManage(player)) return;
				this.timer = null;
				await this.ctx.storage.put('timer', this.timer);
				break;
			}
			default:
				return;
		}

		this.broadcast();
		await this.touch();
	}

	async webSocketClose(ws: WebSocket) {
		await this.load();
		this.lastPing.delete(ws);
		const playerId = (ws.deserializeAttachment() as { playerId: string } | null)?.playerId;
		const player = playerId ? this.players.get(playerId) : undefined;
		if (player && !this.onlineIds().has(player.id)) {
			player.lastSeen = Date.now();
			await this.persistPlayers();
		}
		this.broadcast();
		await this.touch();
	}

	async alarm() {
		await this.load();
		const now = Date.now();

		if (this.round.phase === 'countdown' && this.round.countdownEndsAt !== null) {
			if (now >= this.round.countdownEndsAt - 50) {
				await this.finalizeReveal();
				this.broadcast();
				await this.touch();
			} else {
				await this.ctx.storage.setAlarm(this.round.countdownEndsAt);
			}
			return;
		}

		const lastActivity = ((await this.ctx.storage.get('lastActivity')) as number) ?? 0;
		if (now >= lastActivity + EXPIRY_MS) {
			for (const ws of this.ctx.getWebSockets()) ws.close(1001, 'Room expired');
			await this.ctx.storage.deleteAll();
			this.loaded = false;
		} else {
			await this.ctx.storage.setAlarm(lastActivity + EXPIRY_MS);
		}
	}

	private async handleJoin(ws: WebSocket, msg: Extract<ClientMessage, { type: 'join' }>) {
		if (msg.playerId && this.bannedIds.includes(msg.playerId)) {
			this.send(ws, { type: 'error', message: 'You were removed from this game.' });
			ws.close(1008, 'Removed from game');
			return;
		}

		const name = sanitizeName(msg.name) || 'Anonymous';
		const role: Role = msg.role === 'spectator' ? 'spectator' : 'player';

		let player = msg.playerId && msg.secret ? this.players.get(msg.playerId) : undefined;
		if (player && player.secret !== msg.secret) player = undefined;

		if (!player) {
			if (this.players.size >= MAX_PLAYERS) {
				this.send(ws, { type: 'error', message: 'This room is full.' });
				ws.close(1008, 'Room full');
				return;
			}
			player = {
				id: crypto.randomUUID(),
				secret: crypto.randomUUID(),
				name,
				role,
				joinedAt: Date.now(),
				lastSeen: 0
			};
		} else {
			player.name = name;
			player.role = role;
			player.lastSeen = 0;
		}
		this.players.set(player.id, player);
		ws.serializeAttachment({ playerId: player.id });

		if (this.config!.moderated && (!this.moderatorId || !this.players.has(this.moderatorId))) {
			this.moderatorId = player.id;
			await this.ctx.storage.put('moderatorId', this.moderatorId);
		}

		this.pruneStalePlayers();
		await this.persistPlayers();

		this.send(ws, { type: 'joined', playerId: player.id, secret: player.secret });
		this.broadcast();
	}

	private async startReveal() {
		if (this.round.phase !== 'voting' || Object.keys(this.round.votes).length === 0) return;
		if (this.config!.revealCountdown) {
			this.round.phase = 'countdown';
			this.round.countdownEndsAt = Date.now() + REVEAL_COUNTDOWN_MS;
			await this.persistRound();
			await this.ctx.storage.setAlarm(this.round.countdownEndsAt);
		} else {
			await this.finalizeReveal();
		}
	}

	private async finalizeReveal() {
		this.round.phase = 'revealed';
		this.round.countdownEndsAt = null;
		this.round.result = this.computeResult();

		const entry: HistoryEntry = {
			...this.round.result,
			round: this.round.n,
			endedAt: Date.now()
		};
		this.history = [entry, ...this.history].slice(0, HISTORY_LIMIT);
		await this.ctx.storage.put({ round: this.round, history: this.history });
	}

	private computeResult(): RoundResult {
		const votes = Object.entries(this.round.votes).map(([playerId, card]) => ({
			name: this.players.get(playerId)?.name ?? 'Unknown',
			card
		}));
		return computeRoundResult(votes, this.config!.deck);
	}

	private async checkAutoReveal() {
		if (!this.config?.autoReveal || this.round.phase !== 'voting') return;
		const online = this.onlineIds();
		const activePlayers = [...this.players.values()].filter(
			(p) => p.role === 'player' && online.has(p.id)
		);
		if (
			activePlayers.length > 0 &&
			activePlayers.every((p) => this.round.votes[p.id] !== undefined)
		) {
			await this.startReveal();
		}
	}

	private isModerator(player: StoredPlayer) {
		return player.id === this.moderatorId;
	}

	/** In an open (unmoderated) room everyone manages; otherwise only the moderator. */
	private canManage(player: StoredPlayer) {
		return !this.config!.moderated || this.isModerator(player);
	}

	/** Whoever manages can always reveal; otherwise the config decides. Spectators never reveal via 'all'. */
	private canReveal(player: StoredPlayer) {
		if (this.canManage(player)) return true;
		const who = this.config!.whoCanReveal;
		if (who === 'all') return player.role === 'player';
		return Array.isArray(who) && who.includes(player.id);
	}

	private onlineIds(): Set<string> {
		const ids = new Set<string>();
		const now = Date.now();
		for (const ws of this.ctx.getWebSockets()) {
			if (now - (this.lastPing.get(ws) ?? now) > HEARTBEAT_TIMEOUT_MS) continue;
			const att = ws.deserializeAttachment() as { playerId: string } | null;
			if (att) ids.add(att.playerId);
		}
		return ids;
	}

	/**
	 * Runs on every heartbeat: close sockets whose client went silent
	 * (killed tab, sleeping laptop, dropped network) and tell everyone.
	 */
	private async closeDeadSockets() {
		const now = Date.now();
		const dead: WebSocket[] = [];
		for (const ws of this.ctx.getWebSockets()) {
			const last = this.lastPing.get(ws);
			if (last === undefined) this.lastPing.set(ws, now);
			else if (now - last > HEARTBEAT_TIMEOUT_MS) dead.push(ws);
		}
		if (dead.length === 0) return;

		for (const ws of dead) {
			// Keep the entry at 0 (stale) instead of deleting it: a closing
			// socket can linger in getWebSockets() and must not count as
			// online again. webSocketClose removes it for good.
			this.lastPing.set(ws, 0);
			ws.close(4002, 'Heartbeat timeout');
			const playerId = (ws.deserializeAttachment() as { playerId: string } | null)?.playerId;
			const player = playerId ? this.players.get(playerId) : undefined;
			if (player && !this.onlineIds().has(player.id)) player.lastSeen = now;
		}
		await this.persistPlayers();
		this.broadcast();
	}

	private pruneStalePlayers() {
		const online = this.onlineIds();
		const now = Date.now();
		for (const [id, p] of this.players) {
			if (
				!online.has(id) &&
				id !== this.moderatorId &&
				p.lastSeen > 0 &&
				now - p.lastSeen > STALE_PLAYER_MS
			) {
				this.players.delete(id);
				delete this.round.votes[id];
			}
		}
	}

	private snapshotFor(playerId: string): RoomSnapshot {
		const online = this.onlineIds();
		const revealed = this.round.phase === 'revealed';
		const players: PlayerView[] = [...this.players.values()]
			.toSorted((a, b) => a.joinedAt - b.joinedAt)
			.map((p) => ({
				id: p.id,
				name: p.name,
				role: p.role,
				online: online.has(p.id),
				lastSeen: online.has(p.id) ? 0 : p.lastSeen,
				joinedAt: p.joinedAt,
				hasVoted: this.round.votes[p.id] !== undefined,
				vote: revealed || p.id === playerId ? (this.round.votes[p.id] ?? null) : null,
				isModerator: p.id === this.moderatorId
			}));

		return {
			you: playerId,
			roomName: this.config!.roomName,
			deck: this.config!.deck,
			phase: this.round.phase,
			round: this.round.n,
			countdownEndsAt: this.round.countdownEndsAt,
			autoReveal: this.config!.autoReveal,
			revealCountdown: this.config!.revealCountdown,
			whoCanReveal: this.config!.whoCanReveal,
			showAverage: this.config!.showAverage,
			moderated: this.config!.moderated,
			players,
			result: revealed ? this.round.result : null,
			timer: this.timer,
			history: this.history
		};
	}

	private broadcast() {
		for (const ws of this.ctx.getWebSockets()) {
			const att = ws.deserializeAttachment() as { playerId: string } | null;
			if (att) this.send(ws, { type: 'state', state: this.snapshotFor(att.playerId) });
		}
	}

	private send(ws: WebSocket, msg: ServerMessage) {
		try {
			ws.send(JSON.stringify(msg));
		} catch {
			// socket already closed
		}
	}

	private async persistRound() {
		await this.ctx.storage.put('round', this.round);
	}

	private async persistPlayers() {
		await this.ctx.storage.put('players', Object.fromEntries(this.players));
	}

	/** Record activity and keep the expiry alarm 30 days out (unless a countdown owns the alarm). */
	private async touch() {
		const now = Date.now();
		await this.ctx.storage.put('lastActivity', now);
		if (this.round.phase !== 'countdown') {
			await this.ctx.storage.setAlarm(now + EXPIRY_MS);
		}
	}
}

function sanitizeName(name: unknown): string {
	if (typeof name !== 'string') return '';
	return name.trim().replace(/\s+/g, ' ').slice(0, MAX_NAME_LENGTH);
}
