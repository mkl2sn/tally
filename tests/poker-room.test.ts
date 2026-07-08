import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import type { ClientMessage, Role, RoomSnapshot, ServerMessage } from '../src/lib/protocol';

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
});
