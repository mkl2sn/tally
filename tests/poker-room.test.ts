import { env, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ClientMessage, Role, RoomSnapshot, ServerMessage } from '../src/lib/protocol';

const EXPIRY_MS = 30 * 24 * 60 * 60 * 1000;

const DECK = ['1', '2', '3', '5', '8', '?'];

async function createRoom(id: string, overrides: Record<string, unknown> = {}) {
	const stub = env.POKER_ROOM.get(env.POKER_ROOM.idFromName(id));
	await stub.init({
		roomName: 'Test room',
		deck: DECK,
		autoReveal: false,
		revealCountdown: false,
		...overrides
	});
	return stub;
}

class TestClient {
	private queue: ServerMessage[] = [];
	private waiters: ((msg: ServerMessage) => void)[] = [];

	constructor(private ws: WebSocket) {
		ws.accept();
		ws.addEventListener('message', (event) => {
			const msg = JSON.parse(event.data as string) as ServerMessage;
			const waiter = this.waiters.shift();
			if (waiter) waiter(msg);
			else this.queue.push(msg);
		});
	}

	send(msg: ClientMessage) {
		this.ws.send(JSON.stringify(msg));
	}

	sendRaw(raw: string) {
		this.ws.send(raw);
	}

	async next(): Promise<ServerMessage> {
		const queued = this.queue.shift();
		if (queued) return queued;
		return new Promise((resolve) => this.waiters.push(resolve));
	}

	async nextState(): Promise<RoomSnapshot> {
		for (;;) {
			const msg = await this.next();
			if (msg.type === 'state') return msg.state;
		}
	}

	close() {
		this.ws.close();
	}
}

async function join(stub: DurableObjectStub, name: string, role: Role = 'player') {
	const res = await stub.fetch('https://test/ws', { headers: { Upgrade: 'websocket' } });
	const ws = res.webSocket;
	if (!ws) throw new Error('expected a websocket');
	const client = new TestClient(ws);
	client.send({ type: 'join', name, role });
	return client;
}

describe('PokerRoom', () => {
	it('rejects websockets for rooms that were never created', async () => {
		const stub = env.POKER_ROOM.get(env.POKER_ROOM.idFromName('ghost-room'));
		const res = await stub.fetch('https://test/ws', { headers: { Upgrade: 'websocket' } });
		expect(res.status).toBe(404);
	});

	it('makes the first player moderator', async () => {
		const stub = await createRoom('room-moderator', { moderated: true });
		const alice = await join(stub, 'Alice');
		const state = await alice.nextState();
		expect(state.players).toHaveLength(1);
		expect(state.players[0].isModerator).toBe(true);

		const bob = await join(stub, 'Bob');
		const bobState = await bob.nextState();
		expect(bobState.players.find((p) => p.name === 'Bob')?.isModerator).toBe(false);
		alice.close();
		bob.close();
	});

	it('hides votes until reveal, then computes the result', async () => {
		const stub = await createRoom('room-reveal');
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		await bob.nextState();
		await alice.nextState(); // bob joined

		bob.send({ type: 'vote', card: '5' });
		const bobView = await bob.nextState();
		const aliceView = await alice.nextState();

		expect(bobView.players.find((p) => p.name === 'Bob')?.vote).toBe('5');
		const bobSeenByAlice = aliceView.players.find((p) => p.name === 'Bob');
		expect(bobSeenByAlice?.hasVoted).toBe(true);
		expect(bobSeenByAlice?.vote).toBeNull();

		alice.send({ type: 'vote', card: '8' });
		await alice.nextState();
		await bob.nextState();

		alice.send({ type: 'reveal' });
		const revealed = await bob.nextState();
		expect(revealed.phase).toBe('revealed');
		expect(revealed.result?.average).toBe(6.5);
		expect(revealed.result?.agreement).toBe(0.5);
		expect(revealed.players.find((p) => p.name === 'Alice')?.vote).toBe('8');
		expect(revealed.history).toHaveLength(1);
		alice.close();
		bob.close();
	});

	it('ignores reveal attempts from non-moderators and votes from spectators', async () => {
		const stub = await createRoom('room-permissions', { moderated: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const carol = await join(stub, 'Carol', 'spectator');
		await carol.nextState();
		await alice.nextState();

		carol.send({ type: 'vote', card: '5' });
		carol.send({ type: 'reveal' });
		alice.send({ type: 'vote', card: '3' });

		const state = await alice.nextState();
		expect(state.phase).toBe('voting');
		expect(state.players.filter((p) => p.hasVoted)).toHaveLength(1);
		expect(state.players.find((p) => p.name === 'Carol')?.hasVoted).toBe(false);
		alice.close();
		carol.close();
	});

	it('honours the whoCanReveal setting', async () => {
		const stub = await createRoom('room-whocanreveal', { moderated: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		const bobState = await bob.nextState();
		await alice.nextState();
		const bobId = bobState.you;

		// Default 'all': any player may reveal.
		bob.send({ type: 'vote', card: '3' });
		await bob.nextState();
		await alice.nextState();
		bob.send({ type: 'reveal' });
		expect((await bob.nextState()).phase).toBe('revealed');
		await alice.nextState();

		// Restricted to the moderator: Bob's reveal is ignored.
		alice.send({ type: 'newRound' });
		await alice.nextState();
		await bob.nextState();
		alice.send({ type: 'setWhoCanReveal', value: 'moderator' });
		expect((await alice.nextState()).whoCanReveal).toBe('moderator');
		await bob.nextState();
		bob.send({ type: 'vote', card: '3' });
		await bob.nextState();
		await alice.nextState();
		bob.send({ type: 'reveal' });

		// Specific players: Bob is allowed again.
		alice.send({ type: 'setWhoCanReveal', value: [bobId] });
		const restricted = await bob.nextState();
		expect(restricted.phase).toBe('voting');
		expect(restricted.whoCanReveal).toEqual([bobId]);
		await alice.nextState();
		bob.send({ type: 'reveal' });
		expect((await bob.nextState()).phase).toBe('revealed');
		alice.close();
		bob.close();
	});

	it('lets the moderator change room name and deck, dropping stale votes', async () => {
		const stub = await createRoom('room-live-config', { moderated: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		await bob.nextState();
		await alice.nextState();

		alice.send({ type: 'vote', card: '1' });
		await alice.nextState();
		await bob.nextState();
		bob.send({ type: 'vote', card: '8' });
		await bob.nextState();
		await alice.nextState();

		alice.send({ type: 'setRoomName', name: 'Renamed room' });
		expect((await alice.nextState()).roomName).toBe('Renamed room');
		await bob.nextState();

		// '8' is not in the new deck, so Bob's vote is dropped; Alice's '1' survives.
		alice.send({ type: 'setDeck', deck: ['1', '2', '3'] });
		const state = await alice.nextState();
		expect(state.deck).toEqual(['1', '2', '3']);
		expect(state.players.find((p) => p.name === 'Alice')?.hasVoted).toBe(true);
		expect(state.players.find((p) => p.name === 'Bob')?.hasVoted).toBe(false);

		// Non-moderators cannot change the config.
		bob.send({ type: 'setDeck', deck: ['XS', 'XL'] });
		bob.send({ type: 'vote', card: '2' });
		const after = await bob.nextState();
		expect(after.deck).toEqual(['1', '2', '3']);
		alice.close();
		bob.close();
	});

	it('opens the room irreversibly: everyone manages, nobody is moderator', async () => {
		const stub = await createRoom('room-open', { moderated: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		await bob.nextState();
		await alice.nextState();

		// Only the moderator may open the room; Bob's attempt is ignored (no broadcast).
		bob.send({ type: 'openRoom' });
		alice.send({ type: 'openRoom' });
		const open = await alice.nextState();
		expect(open.moderated).toBe(false);
		expect(open.players.some((p) => p.isModerator)).toBe(false);
		await bob.nextState();

		// Now anyone can manage the game.
		bob.send({ type: 'setRoomName', name: 'Anarchy' });
		expect((await bob.nextState()).roomName).toBe('Anarchy');
		await alice.nextState();

		// The moderator role cannot be claimed back.
		bob.send({ type: 'claimModerator' });
		bob.send({ type: 'vote', card: '3' });
		const after = await bob.nextState();
		expect(after.moderated).toBe(false);
		expect(after.players.some((p) => p.isModerator)).toBe(false);
		alice.close();
		bob.close();
	});

	it('defaults to an open room with no moderator', async () => {
		const stub = await createRoom('room-open-create');
		const alice = await join(stub, 'Alice');
		const state = await alice.nextState();
		expect(state.moderated).toBe(false);
		expect(state.players[0].isModerator).toBe(false);

		alice.send({ type: 'setRoomName', name: 'Free for all' });
		expect((await alice.nextState()).roomName).toBe('Free for all');
		alice.close();
	});

	it('lets the moderator remove a player and blocks their return', async () => {
		const stub = await createRoom('room-kick', { moderated: true });
		const alice = await join(stub, 'Alice');
		const aliceId = (await alice.nextState()).you;
		const bob = await join(stub, 'Bob');
		const bobId = (await bob.nextState()).you;
		await alice.nextState(); // bob joined

		// A non-moderator cannot kick: Bob's attempt is ignored (no broadcast).
		bob.send({ type: 'kick', playerId: aliceId });
		alice.send({ type: 'setRoomName', name: 'Still here' });
		const kept = await alice.nextState();
		expect(kept.roomName).toBe('Still here');
		expect(kept.players).toHaveLength(2);
		await bob.nextState();

		// The moderator removes Bob: he is dropped and told why.
		alice.send({ type: 'kick', playerId: bobId });
		const bobMsg = await bob.next();
		expect(bobMsg.type).toBe('error');
		const afterKick = await alice.nextState();
		expect(afterKick.players).toHaveLength(1);
		expect(afterKick.players[0].name).toBe('Alice');

		// Bob cannot rejoin with his old identity.
		const res = await stub.fetch('https://test/ws', { headers: { Upgrade: 'websocket' } });
		const ghost = new TestClient(res.webSocket!);
		ghost.send({ type: 'join', name: 'Bob', role: 'player', playerId: bobId, secret: 'stale' });
		expect((await ghost.next()).type).toBe('error');

		alice.close();
	});

	it('starts a new round and keeps history', async () => {
		const stub = await createRoom('room-newround');
		const alice = await join(stub, 'Alice');
		await alice.nextState();

		alice.send({ type: 'vote', card: '2' });
		await alice.nextState();
		alice.send({ type: 'reveal' });
		const revealed = await alice.nextState();
		expect(revealed.phase).toBe('revealed');

		alice.send({ type: 'newRound' });
		const fresh = await alice.nextState();
		expect(fresh.round).toBe(2);
		expect(fresh.phase).toBe('voting');
		expect(fresh.players.some((p) => p.hasVoted)).toBe(false);
		expect(fresh.history).toHaveLength(1);
		alice.close();
	});

	it('lets a player rename and switch to spectator, dropping their vote', async () => {
		const stub = await createRoom('room-role-switch');
		const alice = await join(stub, 'Alice');
		await alice.nextState();

		alice.send({ type: 'vote', card: '2' });
		expect((await alice.nextState()).players[0].hasVoted).toBe(true);

		alice.send({ type: 'setRole', role: 'spectator' });
		const spectating = await alice.nextState();
		expect(spectating.players[0].role).toBe('spectator');
		expect(spectating.players[0].hasVoted).toBe(false);

		alice.send({ type: 'rename', name: '  Alice   B. ' });
		expect((await alice.nextState()).players[0].name).toBe('Alice B.');
		alice.close();
	});

	it('lets a player reconnect with their secret and keep identity and vote', async () => {
		const stub = await createRoom('room-reconnect');
		const alice = await join(stub, 'Alice');
		const joined = await alice.next();
		if (joined.type !== 'joined') throw new Error('expected joined message');
		await alice.nextState();

		alice.send({ type: 'vote', card: '5' });
		await alice.nextState();
		alice.close();

		// Right secret: same identity, vote preserved.
		const res = await stub.fetch('https://test/ws', { headers: { Upgrade: 'websocket' } });
		const client = new TestClient(res.webSocket!);
		client.send({
			type: 'join',
			name: 'Alice',
			role: 'player',
			playerId: joined.playerId,
			secret: joined.secret
		});
		const rejoined = await client.next();
		if (rejoined.type !== 'joined') throw new Error('expected joined message');
		expect(rejoined.playerId).toBe(joined.playerId);
		const state = await client.nextState();
		expect(state.players.find((p) => p.id === joined.playerId)?.hasVoted).toBe(true);
		client.close();
	});

	it('treats a reconnect with a wrong secret as a new player', async () => {
		const stub = await createRoom('room-bad-secret');
		const alice = await join(stub, 'Alice');
		const joined = await alice.next();
		if (joined.type !== 'joined') throw new Error('expected joined message');
		await alice.nextState();
		alice.close();

		const res = await stub.fetch('https://test/ws', { headers: { Upgrade: 'websocket' } });
		const impostor = new TestClient(res.webSocket!);
		impostor.send({
			type: 'join',
			name: 'Mallory',
			role: 'player',
			playerId: joined.playerId,
			secret: 'wrong-secret'
		});
		const rejoined = await impostor.next();
		if (rejoined.type !== 'joined') throw new Error('expected joined message');
		expect(rejoined.playerId).not.toBe(joined.playerId);
		expect((await impostor.nextState()).players).toHaveLength(2);
		impostor.close();
	});

	it('rejects players beyond the room limit', async () => {
		const stub = await createRoom('room-full');
		// Seed 50 stored players directly; 50 live websockets would broadcast O(n^2) states.
		await runInDurableObject(stub, (instance) => {
			const room = instance as unknown as { players: Map<string, unknown> };
			for (let i = 0; i < 50; i++) {
				room.players.set(`p${i}`, {
					id: `p${i}`,
					name: `Player ${i}`,
					role: 'player',
					joinedAt: i,
					secret: `s${i}`,
					lastSeen: 0
				});
			}
		});

		const res = await stub.fetch('https://test/ws', { headers: { Upgrade: 'websocket' } });
		const straggler = new TestClient(res.webSocket!);
		straggler.send({ type: 'join', name: 'Straggler', role: 'player' });
		const msg = await straggler.next();
		expect(msg.type).toBe('error');
	});

	it('lets a player claim the moderator role only while the moderator is offline', async () => {
		const stub = await createRoom('room-claim', { moderated: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		await bob.nextState();
		await alice.nextState();

		// Alice is online: Bob's claim is ignored (no broadcast).
		bob.send({ type: 'claimModerator' });
		bob.send({ type: 'vote', card: '1' });
		const denied = await bob.nextState();
		expect(denied.players.find((p) => p.name === 'Alice')?.isModerator).toBe(true);
		await alice.nextState();

		// Alice disconnects: now the claim succeeds.
		alice.close();
		await bob.nextState(); // alice went offline
		bob.send({ type: 'claimModerator' });
		const claimed = await bob.nextState();
		expect(claimed.players.find((p) => p.name === 'Bob')?.isModerator).toBe(true);
		expect(claimed.players.find((p) => p.name === 'Alice')?.isModerator).toBe(false);
		bob.close();
	});

	it('lets the moderator hand over the role', async () => {
		const stub = await createRoom('room-transfer', { moderated: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		const bobId = (await bob.nextState()).you;
		const aliceState = await alice.nextState();
		const aliceId = aliceState.you;

		alice.send({ type: 'transferModerator', playerId: bobId });
		const handed = await alice.nextState();
		expect(handed.players.find((p) => p.id === bobId)?.isModerator).toBe(true);
		expect(handed.players.find((p) => p.id === aliceId)?.isModerator).toBe(false);
		await bob.nextState();

		// Alice is no longer moderator, so she cannot take the role back.
		alice.send({ type: 'transferModerator', playerId: aliceId });
		alice.send({ type: 'vote', card: '1' });
		const after = await alice.nextState();
		expect(after.players.find((p) => p.id === bobId)?.isModerator).toBe(true);
		alice.close();
		bob.close();
	});

	it('clamps the timer duration and lets it be stopped', async () => {
		const stub = await createRoom('room-timer');
		const alice = await join(stub, 'Alice');
		await alice.nextState();

		alice.send({ type: 'startTimer', seconds: 3 });
		expect((await alice.nextState()).timer?.duration).toBe(10);

		alice.send({ type: 'startTimer', seconds: 999999 });
		expect((await alice.nextState()).timer?.duration).toBe(3600);

		alice.send({ type: 'stopTimer' });
		expect((await alice.nextState()).timer).toBeNull();
		alice.close();
	});

	it('adjusts the shared deadline by 30 seconds without restarting the timer', async () => {
		const stub = await createRoom('room-adjust-timer', { moderated: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		await bob.nextState();
		await alice.nextState();
		alice.send({ type: 'startTimer', seconds: 60 });
		const original = (await alice.nextState()).timer!;
		await bob.nextState();

		alice.send({ type: 'adjustTimer', seconds: 30 });
		const extended = (await alice.nextState()).timer!;
		expect(extended.endsAt).toBe(original.endsAt + 30_000);
		expect(extended.duration).toBe(90);
		expect(extended.initialDuration).toBe(60);
		expect((await bob.nextState()).timer).toEqual(extended);

		// Separate adjustments compose against the latest server deadline.
		alice.send({ type: 'adjustTimer', seconds: -30 });
		alice.send({ type: 'adjustTimer', seconds: -30 });
		await alice.nextState();
		const shortened = (await alice.nextState()).timer!;
		expect(shortened.endsAt).toBe(original.endsAt - 30_000);
		expect(shortened.duration).toBe(30);
		expect(shortened.initialDuration).toBe(60);
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.get('timer')).toEqual(shortened);
		});
		alice.close();
		bob.close();
	});

	it('clamps adjustments at zero and one hour and extends expired timers from now', async () => {
		const stub = await createRoom('room-adjust-timer-limits', { moderated: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		alice.send({ type: 'startTimer', seconds: 10 });
		await alice.nextState();
		alice.send({ type: 'adjustTimer', seconds: -30 });
		const expired = (await alice.nextState()).timer!;
		expect(expired.endsAt).toBeLessThanOrEqual(Date.now());
		expect(expired.duration).toBeGreaterThan(0);

		// An old completion must add a fresh 30 seconds, rather than remain expired.
		await runInDurableObject(stub, async (instance) => {
			const room = instance as unknown as { timer: { endsAt: number; duration: number } };
			room.timer.endsAt = Date.now() - 60_000;
		});
		const before = Date.now();
		alice.send({ type: 'adjustTimer', seconds: 30 });
		const resumed = (await alice.nextState()).timer!;
		expect(resumed.endsAt).toBeGreaterThanOrEqual(before + 30_000);
		expect(resumed.endsAt).toBeLessThanOrEqual(Date.now() + 30_000);
		expect(resumed.duration).toBe(30);

		alice.send({ type: 'startTimer', seconds: 3600 });
		await alice.nextState();
		alice.send({ type: 'adjustTimer', seconds: 30 });
		const capped = (await alice.nextState()).timer!;
		expect(capped.endsAt).toBeLessThanOrEqual(Date.now() + 3_600_000);
		expect(capped.duration).toBe(3600);
		alice.close();
	});

	it('ignores adjustments without a timer and rejects players without management permission', async () => {
		const stub = await createRoom('room-adjust-timer-permissions', { moderated: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		alice.send({ type: 'adjustTimer', seconds: 30 });
		alice.send({ type: 'vote', card: '1' });
		expect((await alice.nextState()).timer).toBeNull();
		alice.send({ type: 'startTimer', seconds: 60 });
		const original = (await alice.nextState()).timer;
		const bob = await join(stub, 'Bob');
		await bob.nextState();
		await alice.nextState();
		bob.send({ type: 'adjustTimer', seconds: 30 });
		bob.send({ type: 'vote', card: '2' });
		expect((await bob.nextState()).timer).toEqual(original);
		alice.close();
		bob.close();
	});

	it.each([-30, 30] as const)('rejects a %i second adjustment in an open game', async (seconds) => {
		const stub = await createRoom(`room-open-timer-adjust-${seconds}`);
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		alice.send({ type: 'startTimer', seconds: 60 });
		const original = (await alice.nextState()).timer;
		alice.send({ type: 'adjustTimer', seconds });
		alice.send({ type: 'vote', card: '1' });
		expect((await alice.nextState()).timer).toEqual(original);
		alice.close();
	});

	it('auto-reveals once every online player has voted', async () => {
		const stub = await createRoom('room-autoreveal', { autoReveal: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		await bob.nextState();
		await alice.nextState();

		alice.send({ type: 'vote', card: '3' });
		const waiting = await alice.nextState();
		expect(waiting.phase).toBe('voting');
		await bob.nextState();

		bob.send({ type: 'vote', card: '5' });
		const revealed = await bob.nextState();
		expect(revealed.phase).toBe('revealed');
		expect(revealed.result?.average).toBe(4);
		alice.close();
		bob.close();
	});

	it('finalizes a reveal countdown via its alarm', async () => {
		const stub = await createRoom('room-countdown', { revealCountdown: true });
		const alice = await join(stub, 'Alice');
		await alice.nextState();

		alice.send({ type: 'vote', card: '5' });
		await alice.nextState();
		alice.send({ type: 'reveal' });
		const counting = await alice.nextState();
		expect(counting.phase).toBe('countdown');
		expect(counting.countdownEndsAt).toBeGreaterThan(Date.now());

		// Rewind the countdown instead of sleeping through it, then fire the alarm.
		await runInDurableObject(stub, (instance) => {
			const room = instance as unknown as { round: { countdownEndsAt: number } };
			room.round.countdownEndsAt = Date.now() - 100;
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);

		const revealed = await alice.nextState();
		expect(revealed.phase).toBe('revealed');
		expect(revealed.result?.average).toBe(5);
		expect(revealed.history).toHaveLength(1);
		alice.close();
	});

	for (const moderated of [false, true]) {
		it(`automatically cleans up a player offline for 24 hours (moderated: ${moderated})`, async () => {
			const stub = await createRoom(`cleanup-${moderated}`, { moderated });
			const alice = await join(stub, 'Alice');
			const joined = await alice.next();
			if (joined.type !== 'joined') throw new Error('expected joined');
			await alice.nextState();
			alice.send({ type: 'vote', card: '5' });
			await alice.nextState();
			const bob = await join(stub, 'Bob');
			await bob.nextState();
			await alice.nextState();
			alice.close();
			const offline = await bob.nextState();
			const lastSeen = offline.players.find((p) => p.id === joined.playerId)!.lastSeen;
			await runInDurableObject(stub, async (instance, state) => {
				expect(await state.storage.getAlarm()).toBeLessThanOrEqual(lastSeen + 86_400_000);
				const room = instance as unknown as { players: Map<string, { lastSeen: number }> };
				room.players.get(joined.playerId)!.lastSeen = Date.now() - 86_400_000;
			});
			expect(await runDurableObjectAlarm(stub)).toBe(true);
			const cleaned = await bob.nextState();
			expect(cleaned.players.map((p) => p.name)).toEqual(['Bob']);
			await runInDurableObject(stub, async (_instance, state) => {
				expect(await state.storage.get<Record<string, unknown>>('players')).not.toHaveProperty(
					joined.playerId
				);
				const round = await state.storage.get<{ votes: Record<string, string> }>('round');
				expect(round!.votes).not.toHaveProperty(joined.playerId);
				expect(await state.storage.get('moderatorId')).not.toBe(joined.playerId);
				expect((await state.storage.get('banned')) ?? []).toEqual([]);
			});
			if (moderated) {
				bob.send({ type: 'claimModerator' });
				expect((await bob.nextState()).players[0].isModerator).toBe(true);
			}
			bob.close();
		});
	}

	it('restores identity and vote when reconnecting before cleanup', async () => {
		const stub = await createRoom('cleanup-reconnect', { moderated: true });
		const alice = await join(stub, 'Alice');
		const joined = await alice.next();
		if (joined.type !== 'joined') throw new Error('expected joined');
		await alice.nextState();
		alice.send({ type: 'vote', card: '5' });
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		await bob.nextState();
		await alice.nextState();
		alice.close();
		await bob.nextState();
		const res = await stub.fetch('https://test/ws', { headers: { Upgrade: 'websocket' } });
		const returning = new TestClient(res.webSocket!);
		returning.send({
			type: 'join',
			name: 'Alice',
			role: 'player',
			playerId: joined.playerId,
			secret: joined.secret
		});
		expect(await returning.next()).toEqual(joined);
		const restored = await returning.nextState();
		expect(restored.players.find((p) => p.id === joined.playerId)).toMatchObject({
			online: true,
			lastSeen: 0,
			vote: '5',
			isModerator: true
		});
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBeGreaterThan(Date.now() + 86_400_000);
		});
		returning.close();
		bob.close();
	});

	it('keeps the cleanup deadline through activity and a reveal countdown', async () => {
		const stub = await createRoom('cleanup-countdown', { revealCountdown: true });
		const alice = await join(stub, 'Alice');
		const joined = await alice.next();
		if (joined.type !== 'joined') throw new Error('expected joined');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		await bob.nextState();
		await alice.nextState();
		alice.close();
		await bob.nextState();
		const cleanupAt = Date.now() + 60_000;
		await runInDurableObject(stub, (instance) => {
			const room = instance as unknown as { players: Map<string, { lastSeen: number }> };
			room.players.get(joined.playerId)!.lastSeen = cleanupAt - 86_400_000;
		});
		bob.send({ type: 'vote', card: '3' });
		await bob.nextState();
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBe(cleanupAt);
		});
		bob.send({ type: 'reveal' });
		expect((await bob.nextState()).phase).toBe('countdown');
		let lastActivity: number | undefined;
		await runInDurableObject(stub, async (instance, state) => {
			expect(await state.storage.getAlarm()).toBeLessThan(cleanupAt);
			lastActivity = await state.storage.get<number>('lastActivity');
			const room = instance as unknown as { round: { countdownEndsAt: number } };
			room.round.countdownEndsAt = Date.now() - 100;
		});
		await runDurableObjectAlarm(stub);
		expect((await bob.nextState()).phase).toBe('revealed');
		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.getAlarm()).toBe(cleanupAt);
			expect(await state.storage.get('lastActivity')).toBe(lastActivity);
		});
		bob.close();
	});

	it('wipes an expired room via its alarm', async () => {
		const stub = await createRoom('room-expiry');
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		alice.close();

		await runInDurableObject(stub, async (_instance, state) => {
			await state.storage.put('lastActivity', Date.now() - EXPIRY_MS - 1000);
		});
		expect(await runDurableObjectAlarm(stub)).toBe(true);

		await runInDurableObject(stub, async (_instance, state) => {
			expect(await state.storage.get('config')).toBeUndefined();
			expect(await state.storage.get('players')).toBeUndefined();
		});
		const res = await stub.fetch('https://test/ws', { headers: { Upgrade: 'websocket' } });
		expect(res.status).toBe(404);
	});

	it('drops a player whose heartbeat stopped without a close frame', async () => {
		const stub = await createRoom('room-heartbeat');
		const alice = await join(stub, 'Alice');
		await alice.nextState();
		const bob = await join(stub, 'Bob');
		const bobJoined = await bob.next();
		if (bobJoined.type !== 'joined') throw new Error('expected joined');
		await alice.nextState(); // bob joined

		// A killed tab sends no close frame: the socket stays open but silent.
		await runInDurableObject(stub, (instance, state) => {
			const { lastPing } = instance as unknown as { lastPing: Map<WebSocket, number> };
			for (const ws of state.getWebSockets()) {
				const att = ws.deserializeAttachment() as { playerId: string };
				if (att.playerId === bobJoined.playerId) lastPing.set(ws, Date.now() - 60_000);
			}
		});

		alice.send({ type: 'ping' });
		const state = await alice.nextState();
		const bobView = state.players.find((p) => p.name === 'Bob');
		expect(bobView?.online).toBe(false);
		expect(bobView?.lastSeen).toBeGreaterThan(0);
		alice.close();
	});

	it('survives garbage websocket input without crashing the room', async () => {
		const stub = await createRoom('room-garbage');
		const alice = await join(stub, 'Alice');
		await alice.nextState();

		// Validate messages from an authenticated player, not only anonymous sockets.
		for (const raw of ['null', '[]', '{}', '{"type":"startTimer","seconds":1e999}']) {
			alice.sendRaw(raw);
		}
		alice.sendRaw(JSON.stringify({ type: 'startTimer', seconds: 'soon' }));
		alice.sendRaw(JSON.stringify({ type: 'setAutoReveal', value: 'true' }));
		alice.sendRaw(JSON.stringify({ type: 'setWhoCanReveal', value: [null] }));

		const res = await stub.fetch('https://test/ws', { headers: { Upgrade: 'websocket' } });
		const raw = res.webSocket!;
		raw.accept();
		raw.send('not json at all');
		raw.send('42');
		raw.send(JSON.stringify({ type: 'doesNotExist' }));
		raw.send(JSON.stringify({ type: 'vote', card: 123 }));
		raw.send(JSON.stringify({ type: 'startTimer', seconds: 'soon' }));
		raw.send('x'.repeat(100_000));
		raw.send(new ArrayBuffer(8));

		// The room still works for a real player.
		alice.send({ type: 'vote', card: '2' });
		alice.send({ type: 'reveal' });
		let state = await alice.nextState();
		if (state.phase === 'voting') state = await alice.nextState();
		expect(state.phase).toBe('revealed');
		expect(state.result?.average).toBe(2);
		expect(state.timer).toBeNull();
		expect(state.autoReveal).toBe(false);
		expect(state.whoCanReveal).toBe('all');
		alice.close();
	});
});
