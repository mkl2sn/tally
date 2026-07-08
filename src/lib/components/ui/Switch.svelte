<script lang="ts">
	import { Switch } from 'bits-ui';
	import type { Snippet } from 'svelte';

	let {
		checked = $bindable(false),
		label,
		labelExtra,
		onCheckedChange
	}: {
		checked?: boolean;
		label: string;
		labelExtra?: Snippet;
		onCheckedChange?: (checked: boolean) => void;
	} = $props();
</script>

<label class="flex cursor-pointer items-center justify-between gap-4 text-sm">
	<span class="flex items-center gap-1.5">{label}{@render labelExtra?.()}</span>
	<Switch.Root
		bind:checked
		{onCheckedChange}
		class="h-6 w-10 shrink-0 cursor-pointer rounded-full bg-line transition-colors data-[state=checked]:bg-accent"
	>
		<Switch.Thumb
			class="block size-5 translate-x-0.5 rounded-full bg-surface shadow transition-transform data-[state=checked]:translate-x-[18px]"
		/>
	</Switch.Root>
</label>
