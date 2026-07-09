import { error, json } from '@sveltejs/kit';
import { MAX_ROOM_NAME_LENGTH, sanitizeDeck } from '$lib/protocol';
import type { RequestHandler } from './$types';
import { getPostHogClient } from '$lib/server/posthog';

// No lookalike characters (0/O, 1/l/I) so room ids survive being read aloud.
const ID_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';

function generateRoomId(): string {
	const bytes = crypto.getRandomValues(new Uint8Array(12));
	return [...bytes].map((b) => ID_ALPHABET[b % ID_ALPHABET.length]).join('');
}

export const POST: RequestHandler = async ({ request, platform }) => {
	if (!platform) error(500, 'Platform unavailable');

	const body = (await request.json().catch(() => null)) as {
		roomName?: unknown;
		deck?: unknown;
		autoReveal?: unknown;
		revealCountdown?: unknown;
		moderated?: unknown;
	} | null;
	if (!body) error(400, 'Invalid JSON');

	const roomName =
		typeof body.roomName === 'string' ? body.roomName.trim().slice(0, MAX_ROOM_NAME_LENGTH) : '';
	if (!roomName) error(400, 'Room name is required');

	const deck = sanitizeDeck(body.deck);
	if (deck.length < 2) error(400, 'Deck needs at least 2 cards');

	const roomId = generateRoomId();
	const stub = platform.env.POKER_ROOM.get(platform.env.POKER_ROOM.idFromName(roomId));
	await stub.init({
		roomName,
		deck,
		autoReveal: body.autoReveal === true,
		revealCountdown: body.revealCountdown !== false,
		moderated: body.moderated === true
	});

	const posthog = getPostHogClient();
	posthog.capture({
		distinctId: 'server',
		event: 'room_created',
		properties: {
			deck_size: deck.length,
			is_moderated: body.moderated === true
		}
	});
	await posthog.flush();

	return json({ roomId });
};
