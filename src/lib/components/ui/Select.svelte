<script lang="ts">
	import { Select } from 'bits-ui';
	import IconChevronDown from '~icons/lucide/chevron-down';
	import IconCheck from '~icons/lucide/check';

	let {
		value = $bindable(''),
		items,
		placeholder = 'Select…',
		onValueChange
	}: {
		value?: string;
		items: { value: string; label: string }[];
		placeholder?: string;
		onValueChange?: (value: string) => void;
	} = $props();

	const selectedLabel = $derived(items.find((i) => i.value === value)?.label);
</script>

<Select.Root type="single" bind:value {items} {onValueChange}>
	<Select.Trigger class="field flex items-center justify-between gap-2 text-left">
		<span class={selectedLabel ? '' : 'text-muted'}>{selectedLabel ?? placeholder}</span>
		<IconChevronDown class="size-3.5 shrink-0 text-muted" />
	</Select.Trigger>
	<Select.Portal>
		<Select.Content
			sideOffset={6}
			class="z-50 max-h-72 w-[var(--bits-floating-anchor-width)] overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-lg"
		>
			<Select.Viewport>
				{#each items as item (item.value)}
					<Select.Item
						value={item.value}
						label={item.label}
						class="flex cursor-pointer items-center justify-between rounded-lg px-3 py-2 text-sm data-highlighted:bg-panel"
					>
						{#snippet children({ selected })}
							{item.label}
							{#if selected}
								<IconCheck class="size-3.5 text-accent" />
							{/if}
						{/snippet}
					</Select.Item>
				{/each}
			</Select.Viewport>
		</Select.Content>
	</Select.Portal>
</Select.Root>
