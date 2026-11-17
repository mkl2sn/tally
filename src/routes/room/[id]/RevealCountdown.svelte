<script lang="ts">
	import { countdownDisplaySeconds } from '$lib/protocol';

	let { endsAt, serverNow }: { endsAt: number; serverNow: number } = $props();
	let seconds = $state(3);

	$effect(() => {
		// Translate the shared deadline to a monotonic clock, independent of the browser's date.
		// Fall back to the browser clock for snapshots from an older worker during deployment.
		const deadline = performance.now() + endsAt - (serverNow ?? Date.now());
		let timeout: ReturnType<typeof setTimeout> | undefined;
		function tick() {
			const remaining = deadline - performance.now();
			const next = countdownDisplaySeconds(remaining);
			seconds = next;
			if (next > 1) {
				timeout = setTimeout(tick, Math.ceil(remaining - (next - 1) * 1000));
			}
		}
		tick();
		return () => clearTimeout(timeout);
	});
</script>

{#key seconds}
	<div class="pulse-count text-7xl font-extrabold tracking-tight">{seconds}</div>
{/key}
