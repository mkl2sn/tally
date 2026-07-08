<script lang="ts">
	import IconSun from '~icons/lucide/sun';
	import IconMoon from '~icons/lucide/moon';

	let dark = $state(false);

	$effect(() => {
		dark = document.documentElement.classList.contains('dark');
	});

	function toggle() {
		dark = !dark;
		document.documentElement.classList.toggle('dark', dark);
		localStorage.setItem('tally:theme', dark ? 'dark' : 'light');
	}
</script>

<button
	onclick={toggle}
	class="rounded-full p-2 text-muted transition-colors hover:bg-panel hover:text-ink"
	aria-label={dark ? 'Switch to light mode' : 'Switch to dark mode'}
	title={dark ? 'Switch to light mode' : 'Switch to dark mode'}
>
	{#if dark}
		<IconSun class="size-4" />
	{:else}
		<IconMoon class="size-4" />
	{/if}
</button>
