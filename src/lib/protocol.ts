// Shared types and constants for client <-> PokerRoom communication.

export type Role = 'player' | 'spectator';
export type Phase = 'voting' | 'countdown' | 'revealed';
/** Who may reveal cards: everyone, only the moderator, or a list of player ids. */
export type WhoCanReveal = 'all' | 'moderator' | string[];

export const DECK_PRESETS = [
	{
		id: 'fibonacci',
		label: 'Fibonacci',
		cards: ['0', '1', '2', '3', '5', '8', '13', '21', '34', '55', '89', '?', '☕']
	},
	{
		id: 'modified',
		label: 'Modified Fibonacci',
		cards: ['0', '½', '1', '2', '3', '5', '8', '13', '20', '40', '100', '?', '☕']
	},
	{ id: 'tshirt', label: 'T-Shirt Sizes', cards: ['XS', 'S', 'M', 'L', 'XL', 'XXL', '?', '☕'] },
	{
		id: 'powers',
		label: 'Powers of 2',
		cards: ['0', '1', '2', '4', '8', '16', '32', '64', '?', '☕']
	}
] as const;

export const MAX_NAME_LENGTH = 32;
export const MAX_ROOM_NAME_LENGTH = 64;
export const MAX_DECK_SIZE = 20;
export const MAX_CARD_LENGTH = 5;
export const REVEAL_COUNTDOWN_MS = 3000;
/** Offline players disappear from the presence list after this long. */
export const OFFLINE_GRACE_MS = 30_000;

export interface PlayerView {
	id: string;
	name: string;
	role: Role;
	online: boolean;
	/** Epoch ms of last disconnect; 0 while online. */
	lastSeen: number;
	joinedAt: number;
	hasVoted: boolean;
	/** Card value; only present for yourself or after reveal. */
	vote: string | null;
	isModerator: boolean;
}

export interface Distribution {
	card: string;
	count: number;
}

export interface RoundResult {
	average: number | null;
	/** Share of votes matching the most common card, 0..1. */
	agreement: number;
	distribution: Distribution[];
	votes: { name: string; card: string }[];
}

export interface HistoryEntry extends RoundResult {
	round: number;
	endedAt: number;
}

export interface TimerState {
	endsAt: number;
	duration: number;
}

export interface RoomSnapshot {
	you: string;
	roomName: string;
	deck: string[];
	phase: Phase;
	round: number;
	countdownEndsAt: number | null;
	autoReveal: boolean;
	revealCountdown: boolean;
	whoCanReveal: WhoCanReveal;
	showAverage: boolean;
	/** False once the room has been opened: no moderator, everyone manages. Irreversible. */
	moderated: boolean;
	players: PlayerView[];
	result: RoundResult | null;
	timer: TimerState | null;
	history: HistoryEntry[];
}

export type ClientMessage =
	| { type: 'join'; name: string; role: Role; playerId?: string; secret?: string }
	| { type: 'vote'; card: string | null }
	| { type: 'reveal' }
	| { type: 'newRound' }
	| { type: 'setRole'; role: Role }
	| { type: 'rename'; name: string }
	| { type: 'setRoomName'; name: string }
	| { type: 'setDeck'; deck: string[] }
	| { type: 'setAutoReveal'; value: boolean }
	| { type: 'setRevealCountdown'; value: boolean }
	| { type: 'setWhoCanReveal'; value: WhoCanReveal }
	| { type: 'setShowAverage'; value: boolean }
	| { type: 'transferModerator'; playerId: string }
	| { type: 'kick'; playerId: string }
	| { type: 'claimModerator' }
	| { type: 'openRoom' }
	| { type: 'startTimer'; seconds: number }
	| { type: 'stopTimer' };

export type ServerMessage =
	| { type: 'joined'; playerId: string; secret: string }
	| { type: 'state'; state: RoomSnapshot }
	| { type: 'error'; message: string };

/** Trim, dedupe and cap a raw deck. A usable deck has at least 2 cards. */
export function sanitizeDeck(raw: unknown): string[] {
	if (!Array.isArray(raw)) return [];
	return [
		...new Set(
			raw
				.filter((c): c is string => typeof c === 'string')
				.map((c) => c.trim().slice(0, MAX_CARD_LENGTH))
				.filter((c) => c.length > 0)
		)
	].slice(0, MAX_DECK_SIZE);
}

/** Numeric value of a card for averaging; null for non-numeric cards like "?", "☕", "XL". */
export function cardNumericValue(card: string): number | null {
	if (card === '½') return 0.5;
	const n = Number(card);
	return Number.isFinite(n) && card.trim() !== '' ? n : null;
}

export function countdownDisplaySeconds(msRemaining: number): number {
	return Math.min(
		Math.ceil(REVEAL_COUNTDOWN_MS / 1000),
		Math.max(1, Math.ceil(msRemaining / 1000))
	);
}
