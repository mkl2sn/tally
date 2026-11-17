<script lang="ts">
	let { size = 32, wordmark = false }: { size?: number; wordmark?: boolean } = $props();
</script>

<span class="inline-flex items-center gap-2">
	<!-- Tally mark: four strokes, the fifth crosses — a vote counted. -->
	<svg
		width={size}
		height={size}
		viewBox="0 0 48 48"
		fill="none"
		aria-hidden="true"
		class="shrink-0"
		stroke-width="5"
		stroke-linecap="round"
	>
		<path d="M9 10v28M19 10v28M29 10v28M39 10v28" class="stroke-ink" />
		<path d="M5 33L43 15" class="stroke-accent" />
	</svg>
	{#if wordmark}
		<span class="text-2xl font-extrabold tracking-tight">Tally</span>
	{/if}
</span>
