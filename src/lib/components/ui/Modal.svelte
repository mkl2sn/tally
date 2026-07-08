<script lang="ts">
	import { Dialog } from 'bits-ui';
	import IconX from '~icons/lucide/x';
	import type { Snippet } from 'svelte';

	let {
		open = $bindable(false),
		title,
		wide = false,
		children
	}: { open?: boolean; title: string; wide?: boolean; children: Snippet } = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Portal>
		<Dialog.Overlay class="modal-overlay fixed inset-0 z-40 bg-black/40" />
		<Dialog.Content
			class="modal-content fixed top-1/2 left-1/2 z-50 flex max-h-[85dvh] w-[calc(100vw-2rem)] {wide
				? 'max-w-lg'
				: 'max-w-md'} -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-line bg-surface p-6 shadow-xl"
		>
			<div class="mb-4 flex items-center justify-between gap-4">
				<Dialog.Title class="text-lg font-bold">{title}</Dialog.Title>
				<Dialog.Close
					class="-mr-1.5 rounded-full p-1.5 text-muted transition-colors hover:bg-panel hover:text-ink"
					aria-label="Close"
				>
					<IconX class="size-4" />
				</Dialog.Close>
			</div>
			<!-- Padding + negative margin keep focus outlines visible despite overflow clipping. -->
			<div class="-m-1.5 min-h-0 flex-1 overflow-y-auto p-1.5">
				{@render children()}
			</div>
		</Dialog.Content>
	</Dialog.Portal>
</Dialog.Root>
