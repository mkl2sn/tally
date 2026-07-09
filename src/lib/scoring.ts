import { cardNumericValue, type RoundResult } from './protocol';

/** Compute average, agreement and distribution for a finished round. */
export function computeRoundResult(
	votes: { name: string; card: string }[],
	deck: string[]
): RoundResult {
	const counts = new Map<string, number>();
	for (const { card } of votes) counts.set(card, (counts.get(card) ?? 0) + 1);
	const distribution = [...counts.entries()]
		.map(([card, count]) => ({ card, count }))
		.toSorted((a, b) => b.count - a.count || deck.indexOf(a.card) - deck.indexOf(b.card));

	const numeric = votes
		.map(({ card }) => cardNumericValue(card))
		.filter((n): n is number => n !== null);
	const average =
		numeric.length > 0
			? Math.round((numeric.reduce((a, b) => a + b, 0) / numeric.length) * 10) / 10
			: null;

	const sorted = numeric.toSorted((a, b) => a - b);
	const mid = Math.floor(sorted.length / 2);
	const median =
		sorted.length === 0
			? null
			: sorted.length % 2 === 1
				? sorted[mid]
				: Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;

	const agreement = votes.length > 0 ? (distribution[0]?.count ?? 0) / votes.length : 0;

	return {
		average,
		median,
		agreement,
		distribution,
		votes: votes.toSorted((a, b) => a.name.localeCompare(b.name))
	};
}

/**
 * Lowest and highest numeric votes, to flag the outliers worth discussing.
 * Non-numeric cards (?, ☕) are ignored. Returns null when there is nothing to
 * flag: fewer than three numeric votes, everyone on the same number, or neither
 * extreme is a lone outlier. An extreme is only reported when exactly one player
 * picked it - a shared extreme is a cluster, not an outlier - so `low`/`high`
 * may individually be null.
 */
export function voteSpread(
	votes: { card: string }[]
): { low: number | null; high: number | null } | null {
	const numeric = votes.map((v) => cardNumericValue(v.card)).filter((n): n is number => n !== null);
	if (numeric.length < 3) return null;
	const low = Math.min(...numeric);
	const high = Math.max(...numeric);
	if (low === high) return null;
	const lowUnique = numeric.filter((n) => n === low).length === 1;
	const highUnique = numeric.filter((n) => n === high).length === 1;
	if (!lowUnique && !highUnique) return null;
	return { low: lowUnique ? low : null, high: highUnique ? high : null };
}
