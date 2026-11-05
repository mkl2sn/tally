import type { ClientMessage } from '../protocol';

const MAX_MESSAGE_LENGTH = 16_384;

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isClientMessage(value: unknown): value is ClientMessage {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
	const msg = value as Record<string, unknown>;
	switch (msg.type) {
		case 'ping':
		case 'reveal':
		case 'newRound':
		case 'claimModerator':
		case 'openRoom':
		case 'stopTimer':
			return true;
		case 'join':
			return (
				typeof msg.name === 'string' &&
				(msg.role === 'player' || msg.role === 'spectator') &&
				(msg.playerId === undefined || typeof msg.playerId === 'string') &&
				(msg.secret === undefined || typeof msg.secret === 'string')
			);
		case 'vote':
			return msg.card === null || typeof msg.card === 'string';
		case 'setRole':
			return msg.role === 'player' || msg.role === 'spectator';
		case 'rename':
		case 'setRoomName':
			return typeof msg.name === 'string';
		case 'setDeck':
			return isStringArray(msg.deck);
		case 'setAutoReveal':
		case 'setRevealCountdown':
		case 'setShowAverage':
			return typeof msg.value === 'boolean';
		case 'setWhoCanReveal':
			return msg.value === 'all' || msg.value === 'moderator' || isStringArray(msg.value);
		case 'transferModerator':
		case 'kick':
			return typeof msg.playerId === 'string';
		case 'startTimer':
			return typeof msg.seconds === 'number' && Number.isFinite(msg.seconds);
		default:
			return false;
	}
}

/** Validate untrusted input before it can affect room state or presence. */
export function parseClientMessage(raw: string | ArrayBuffer): ClientMessage | null {
	if (typeof raw !== 'string' || raw.length > MAX_MESSAGE_LENGTH) return null;
	let value: unknown;
	try {
		value = JSON.parse(raw);
	} catch {
		return null;
	}
	return isClientMessage(value) ? value : null;
}
