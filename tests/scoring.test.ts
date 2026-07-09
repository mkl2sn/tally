import { describe, expect, it } from 'vitest';
import { cardNumericValue, countdownDisplaySeconds } from '../src/lib/protocol';
import { computeRoundResult, voteSpread } from '../src/lib/scoring';

const DECK = ['0', '½', '1', '2', '3', '5', '8', '13', '?', '☕'];

describe('cardNumericValue', () => {
	it('parses numeric cards', () => {
		expect(cardNumericValue('0')).toBe(0);
		expect(cardNumericValue('13')).toBe(13);
		expect(cardNumericValue('½')).toBe(0.5);
	});

	it('returns null for non-numeric cards', () => {
		expect(cardNumericValue('?')).toBeNull();
		expect(cardNumericValue('☕')).toBeNull();
		expect(cardNumericValue('XL')).toBeNull();
		expect(cardNumericValue('')).toBeNull();
		expect(cardNumericValue('  ')).toBeNull();
	});
});

describe('countdownDisplaySeconds', () => {
	it('starts a three second countdown at 3 even with slight clock drift', () => {
		expect(countdownDisplaySeconds(3001)).toBe(3);
		expect(countdownDisplaySeconds(3000)).toBe(3);
		expect(countdownDisplaySeconds(2001)).toBe(3);
		expect(countdownDisplaySeconds(2000)).toBe(2);
		expect(countdownDisplaySeconds(1001)).toBe(2);
		expect(countdownDisplaySeconds(1000)).toBe(1);
	});
});

describe('computeRoundResult', () => {
	it('averages numeric votes to one decimal', () => {
		const result = computeRoundResult(
			[
				{ name: 'Alice', card: '5' },
				{ name: 'Bob', card: '8' }
			],
			DECK
		);
		expect(result.average).toBe(6.5);
		expect(result.agreement).toBe(0.5);
	});

	it('excludes non-numeric votes from the average but not from agreement', () => {
		const result = computeRoundResult(
			[
				{ name: 'Alice', card: '5' },
				{ name: 'Bob', card: '?' }
			],
			DECK
		);
		expect(result.average).toBe(5);
		expect(result.agreement).toBe(0.5);
	});

	it('has no average for fully non-numeric decks', () => {
		const result = computeRoundResult(
			[
				{ name: 'Alice', card: 'M' },
				{ name: 'Bob', card: 'M' }
			],
			['S', 'M', 'L']
		);
		expect(result.average).toBeNull();
		expect(result.agreement).toBe(1);
	});

	it('sorts the distribution by count, then deck order', () => {
		const result = computeRoundResult(
			[
				{ name: 'A', card: '8' },
				{ name: 'B', card: '8' },
				{ name: 'C', card: '3' },
				{ name: 'D', card: '1' }
			],
			DECK
		);
		expect(result.distribution).toEqual([
			{ card: '8', count: 2 },
			{ card: '1', count: 1 },
			{ card: '3', count: 1 }
		]);
	});

	it('sorts revealed votes by player name', () => {
		const result = computeRoundResult(
			[
				{ name: 'Zoe', card: '1' },
				{ name: 'Ada', card: '2' }
			],
			DECK
		);
		expect(result.votes.map((v) => v.name)).toEqual(['Ada', 'Zoe']);
	});

	it('handles an empty round', () => {
		const result = computeRoundResult([], DECK);
		expect(result.average).toBeNull();
		expect(result.agreement).toBe(0);
		expect(result.distribution).toEqual([]);
	});
});

describe('voteSpread', () => {
	it('returns the lowest and highest numeric votes', () => {
		expect(voteSpread([{ card: '3' }, { card: '8' }, { card: '1' }])).toEqual({ low: 1, high: 8 });
	});

	it('ignores non-numeric cards', () => {
		expect(voteSpread([{ card: '2' }, { card: '?' }, { card: '☕' }, { card: '13' }])).toEqual({
			low: 2,
			high: 13
		});
	});

	it('is null when everyone agrees', () => {
		expect(voteSpread([{ card: '5' }, { card: '5' }])).toBeNull();
	});

	it('is null with fewer than two numeric votes', () => {
		expect(voteSpread([{ card: '5' }, { card: '?' }])).toBeNull();
		expect(voteSpread([])).toBeNull();
	});
});
