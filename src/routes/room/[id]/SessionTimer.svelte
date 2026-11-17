<script lang="ts">
	import IconTimer from '~icons/lucide/timer';
	import IconBellRing from '~icons/lucide/bell-ring';
	import IconX from '~icons/lucide/x';

	let {
		remaining,
		duration,
		canManage,
		canAdjust,
		onstop,
		onadjust
	}: {
		remaining: number;
		duration: number;
		canManage: boolean;
		canAdjust: boolean;
		onstop: () => void;
		onadjust: (seconds: -30 | 30) => void;
	} = $props();

	const expired = $derived(remaining === 0);
	const ending = $derived(remaining > 0 && remaining <= 10);
	const time = $derived(`${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`);
	const status = $derived(expired ? "Time's up" : ending ? 'Ending soon' : 'Session timer');
	let bell = $state<HTMLSpanElement>();
	let previousRemaining: number | undefined;

	$effect(() => {
		const justExpired = previousRemaining !== undefined && previousRemaining > 0 && remaining === 0;
		previousRemaining = remaining;
		const target = bell;
		if (!justExpired || !target || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

		const animation = target.animate(
			[0, -12, 12, -8, 8, -4, 4, 0].map((degrees) => ({ transform: `rotate(${degrees}deg)` })),
			{ duration: 480, iterations: 3, easing: 'ease-out' }
		);
		return () => animation.cancel();
	});
</script>

<section
	aria-label="Session timer"
	data-state={expired ? 'expired' : ending ? 'ending' : 'running'}
	class="pointer-events-auto w-full max-w-64 rounded-xl border bg-surface p-3 shadow-lg shadow-black/5 dark:shadow-black/20 {expired ||
	ending
		? 'border-danger/50'
		: 'border-line'}"
>
	<div class="flex items-center gap-2">
		<div class="relative grid size-10 shrink-0 place-items-center" aria-hidden="true">
			<svg viewBox="0 0 56 56" class="absolute inset-0 size-10 -rotate-90 fill-none" aria-hidden="true">
				<circle cx="28" cy="28" r="24" stroke-width="3" class="stroke-line" />
				<circle
					cx="28"
					cy="28"
					r="24"
					pathLength="100"
					stroke-width="3"
					stroke-linecap="round"
					stroke-dasharray="100"
					stroke-dashoffset={100 * (1 - Math.min(1, remaining / duration))}
					class={ending || expired ? 'stroke-danger' : 'stroke-accent'}
				/>
			</svg>
			<IconTimer
				class="absolute size-5 transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {expired
					? 'opacity-0 motion-safe:scale-[0.25] motion-safe:blur-[4px]'
					: 'opacity-100 motion-safe:scale-100 motion-safe:blur-0'} {ending ? 'text-danger' : 'text-accent'}"
			/>
			<span bind:this={bell} data-timer-bell class="absolute grid size-5 place-items-center">
				<IconBellRing
					class="size-5 text-danger transition-[opacity,scale,filter] duration-300 ease-[cubic-bezier(0.2,0,0,1)] {expired
						? 'opacity-100 motion-safe:scale-100 motion-safe:blur-0'
						: 'opacity-0 motion-safe:scale-[0.25] motion-safe:blur-[4px]'}"
				/>
			</span>
		</div>
		<div class="min-w-0 flex-1">
			<p role="status" class="text-xs font-semibold {expired || ending ? 'text-danger' : 'text-muted'}">
				{status}
			</p>
			<div
				role="timer"
				aria-label="Time remaining"
				aria-live="off"
				class="text-3xl leading-none font-semibold tracking-tight tabular-nums {expired || ending
					? 'text-danger'
					: 'text-ink'}"
			>
				{time}
			</div>
		</div>
		{#if canManage}
			<button
				type="button"
				onclick={onstop}
				aria-label="Stop timer"
				title={expired ? 'Dismiss timer' : 'Stop timer'}
				class="grid size-8 shrink-0 place-items-center rounded-full text-muted hover:bg-panel hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent motion-safe:transition-[scale] motion-safe:duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96]"
			>
				<IconX class="size-4" />
			</button>
		{/if}
	</div>
	{#if canAdjust && !expired}
		<div class="mt-2 flex gap-2">
			{#each [-30, 30] as seconds (seconds)}
				<button
					type="button"
					onclick={() => onadjust(seconds as -30 | 30)}
					aria-label={seconds < 0 ? 'Remove 30 seconds' : 'Add 30 seconds'}
					disabled={seconds > 0 && remaining >= 3600}
					class="h-9 flex-1 rounded-full bg-panel text-sm font-semibold text-ink hover:bg-accent-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-40 motion-safe:transition-[scale] motion-safe:duration-150 motion-safe:ease-out motion-safe:enabled:active:scale-[0.96]"
				>
					{seconds > 0 ? '+' : ''}{seconds}s
				</button>
			{/each}
		</div>
	{/if}
</section>
