import { describe, expect, it } from 'vitest';
import { cardNumericValue, countdownDisplaySeconds } from '../src/lib/protocol';
import { computeRoundResult, outlierFor, voteSpread } from '../src/lib/scoring';

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

	it('takes the middle numeric vote as the median (odd count)', () => {
		const result = computeRoundResult(
			[
				{ name: 'A', card: '3' },
				{ name: 'B', card: '13' },
				{ name: 'C', card: '5' }
			],
			DECK
		);
		expect(result.median).toBe(5);
	});

	it('averages the two middle votes for an even count, ignoring non-numeric cards', () => {
		const result = computeRoundResult(
			[
				{ name: 'A', card: '5' },
				{ name: 'B', card: '8' },
				{ name: 'C', card: '?' }
			],
			DECK
		);
		expect(result.median).toBe(6.5);
	});

	it('has no median for fully non-numeric votes', () => {
		const result = computeRoundResult(
			[
				{ name: 'A', card: '?' },
				{ name: 'B', card: '☕' }
			],
			DECK
		);
		expect(result.median).toBeNull();
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
	it('returns the lowest and highest numeric votes when both are unique', () => {
		expect(voteSpread([{ card: '3' }, { card: '8' }, { card: '1' }])).toEqual({ low: 1, high: 8 });
	});

	it('ignores non-numeric cards', () => {
		expect(
			voteSpread([{ card: '2' }, { card: '?' }, { card: '☕' }, { card: '8' }, { card: '13' }])
		).toEqual({ low: 2, high: 13 });
	});

	it('does not flag a shared extreme (the cluster is not an outlier)', () => {
		expect(voteSpread([{ card: '8' }, { card: '8' }, { card: '21' }])).toEqual({
			low: null,
			high: 21
		});
		expect(voteSpread([{ card: '3' }, { card: '13' }, { card: '13' }])).toEqual({
			low: 3,
			high: null
		});
	});

	it('is null when both extremes are shared', () => {
		expect(
			voteSpread([{ card: '5' }, { card: '5' }, { card: '13' }, { card: '13' }])
		).toBeNull();
	});

	it('is null when everyone agrees', () => {
		expect(voteSpread([{ card: '5' }, { card: '5' }, { card: '5' }])).toBeNull();
	});

	it('is null with fewer than three numeric votes', () => {
		expect(voteSpread([{ card: '5' }, { card: '13' }])).toBeNull();
		expect(voteSpread([{ card: '5' }, { card: '?' }])).toBeNull();
		expect(voteSpread([])).toBeNull();
	});
});

describe('outlierFor', () => {
	it('flags a vote that matches an extreme', () => {
		expect(outlierFor('21', { low: null, high: 21 })).toBe('high');
		expect(outlierFor('3', { low: 3, high: null })).toBe('low');
	});

	it('is null for votes between the extremes', () => {
		expect(outlierFor('8', { low: 3, high: 21 })).toBeNull();
	});

	it('never flags non-numeric cards, even against a null extreme', () => {
		expect(outlierFor('?', { low: 3, high: null })).toBeNull();
		expect(outlierFor('☕', { low: null, high: 21 })).toBeNull();
	});

	it('is null without a spread or a vote', () => {
		expect(outlierFor('8', null)).toBeNull();
		expect(outlierFor(null, { low: 3, high: 21 })).toBeNull();
	});
});
