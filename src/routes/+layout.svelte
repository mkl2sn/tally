<script lang="ts">
	import { Tooltip } from 'bits-ui';
	import './layout.css';
	import favicon from '$lib/assets/favicon.svg';

	let { children } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>
<Tooltip.Provider delayDuration={200} disableHoverableContent>
	{@render children()}
</Tooltip.Provider>
