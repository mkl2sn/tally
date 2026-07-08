<script lang="ts">
	import type { HistoryEntry } from '$lib/protocol';
	import Modal from './ui/Modal.svelte';

	let {
		history,
		showAverage = true,
		open = $bindable(false)
	}: { history: HistoryEntry[]; showAverage?: boolean; open?: boolean } = $props();

	function formatTime(ts: number): string {
		return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
	}
</script>

<Modal bind:open title="Voting history" wide>
	{#if history.length === 0}
		<p class="py-8 text-center text-sm text-muted">
			No rounds yet. Reveal a round and it shows up here.
		</p>
	{:else}
		<ol class="grid gap-3">
			{#each history as entry (entry.round + '-' + entry.endedAt)}
				<li class="rounded-xl border border-line bg-panel p-3">
					<div class="flex items-baseline justify-between text-sm">
						<span class="font-semibold">Round {entry.round}</span>
						<span class="text-sm text-muted">{formatTime(entry.endedAt)}</span>
					</div>
					<div class="mt-1.5 flex gap-4 text-sm">
						{#if showAverage}
							<span>
								<span class="text-muted">Avg</span>
								<strong class="tabular-nums">{entry.average ?? '–'}</strong>
							</span>
						{/if}
						<span class="inline-flex items-center gap-1.5">
							<span class="text-muted">Agreement</span>
							<span
								class="size-2.5 rounded-full"
								style="background: hsl({entry.agreement * 120} 65% 42%)"
							></span>
							<strong class="tabular-nums">{Math.round(entry.agreement * 100)}%</strong>
						</span>
					</div>
					<div class="mt-2 flex flex-wrap gap-1.5">
						{#each entry.distribution as { card, count } (card)}
							<span
								class="inline-flex items-center gap-1 rounded-md border border-line bg-surface px-1.5 py-0.5 text-sm"
							>
								<span class="font-bold">{card}</span>
								<span class="text-muted">×{count}</span>
							</span>
						{/each}
					</div>
					<details class="mt-2 text-sm text-muted">
						<summary class="cursor-pointer select-none">Who voted what</summary>
						<ul class="mt-1 grid gap-0.5">
							{#each entry.votes as { name, card }, i (i)}
								<li class="flex justify-between">
									<span class="truncate">{name}</span>
									<span class="font-bold text-ink tabular-nums">{card}</span>
								</li>
							{/each}
						</ul>
					</details>
				</li>
			{/each}
		</ol>
	{/if}
</Modal>
