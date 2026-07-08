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

	const agreement = votes.length > 0 ? (distribution[0]?.count ?? 0) / votes.length : 0;

	return {
		average,
		agreement,
		distribution,
		votes: votes.toSorted((a, b) => a.name.localeCompare(b.name))
	};
}
