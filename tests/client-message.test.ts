import { describe, expect, it } from 'vitest';
import { parseClientMessage } from '../src/lib/server/client-message';

describe('untrusted WebSocket input', () => {
	it.each(['null', '42', 'true', '"join"', '[]', '{}', '{', '{"type":"unknown"}', '{"type":null}'])(
		'ignores malformed or non-message input: %s',
		(raw) => {
			expect(parseClientMessage(raw)).toBeNull();
		}
	);

	it.each([
		{ type: 'join', name: 'Alice', role: 'admin' },
		{ type: 'join', name: 'Alice', role: 'player', secret: {} },
		{ type: 'join', name: null, role: 'player' },
		{ type: 'vote', card: 5 },
		{ type: 'rename', name: {} },
		{ type: 'setRoomName', name: [] },
		{ type: 'setDeck', deck: ['1', 2] },
		{ type: 'setAutoReveal', value: 'true' },
		{ type: 'setRevealCountdown', value: 1 },
		{ type: 'setShowAverage', value: null },
		{ type: 'setRole', role: 'admin' },
		{ type: 'setWhoCanReveal', value: ['player-id', {}] },
		{ type: 'transferModerator', playerId: {} },
		{ type: 'kick', playerId: 42 },
		{ type: 'startTimer', seconds: '60' },
		{ type: 'startTimer', seconds: null }
	])('rejects invalid message fields: %j', (message) => {
		expect(parseClientMessage(JSON.stringify(message))).toBeNull();
	});

	it('rejects overflowing JSON numbers, binary frames and oversized payloads', () => {
		expect(parseClientMessage('{"type":"startTimer","seconds":1e999}')).toBeNull();
		expect(parseClientMessage(new ArrayBuffer(8))).toBeNull();
		expect(
			parseClientMessage(JSON.stringify({ type: 'rename', name: 'x'.repeat(20_000) }))
		).toBeNull();
	});

	it.each([
		{ type: 'join', name: 'Alice', role: 'player' },
		{ type: 'join', name: 'Alice', role: 'spectator', playerId: 'id', secret: 'secret' },
		{ type: 'vote', card: null },
		{ type: 'vote', card: '5' },
		{ type: 'setDeck', deck: ['1', '2', '?'] },
		{ type: 'setWhoCanReveal', value: ['player-id'] },
		{ type: 'setShowAverage', value: false },
		{ type: 'startTimer', seconds: 60 },
		{ type: 'stopTimer' },
		{ type: 'ping' }
	])('preserves valid client messages: %j', (message) => {
		expect(parseClientMessage(JSON.stringify(message))).toEqual(message);
	});
});
