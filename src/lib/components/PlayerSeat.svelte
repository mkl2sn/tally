<script lang="ts">
	import { DropdownMenu, Tooltip } from 'bits-ui';
	import IconCrown from '~icons/lucide/crown';
	import IconWifiOff from '~icons/lucide/wifi-off';
	import IconEye from '~icons/lucide/eye';
	import IconArrowUp from '~icons/lucide/arrow-up';
	import IconArrowDown from '~icons/lucide/arrow-down';
	import type { PlayerView } from '$lib/protocol';

	let {
		player,
		revealed,
		isYou,
		outlier = null,
		position = 'bottom',
		canMakeModerator = false,
		onmakemoderator,
		onkick
	}: {
		player: PlayerView;
		revealed: boolean;
		isYou: boolean;
		outlier?: 'high' | 'low' | null;
		position?: 'top' | 'bottom';
		canMakeModerator?: boolean;
		onmakemoderator?: () => void;
		onkick?: () => void;
	} = $props();

	const flipped = $derived(revealed && player.vote !== null);
</script>

<div class="deal-in flex w-16 flex-col items-center gap-1.5">
	{#if player.role === 'spectator'}
		<div
			class="flex h-14 w-10 items-center justify-center rounded-lg border border-dashed border-line text-muted"
			class:opacity-40={!player.online}
			title="{player.name} is watching"
		>
			<IconEye class="size-4" />
		</div>
	{:else}
		<div class="flip-scene h-14 w-10" class:opacity-40={!player.online}>
			<div class="flip-inner relative h-full w-full" class:flipped>
				<div class="flip-front absolute inset-0">
					{#if player.hasVoted}
						<div class="card-back-tally h-full w-full rounded-lg shadow-sm"></div>
					{:else}
						<div class="h-full w-full rounded-lg border-2 border-dashed border-line"></div>
					{/if}
				</div>
				<div
					class="flip-back absolute inset-0 flex items-center justify-center rounded-lg bg-accent-soft text-lg font-bold text-accent tabular-nums shadow-sm {outlier
						? 'ring-2 ring-accent'
						: ''}"
				>
					{player.vote ?? ''}
				</div>
			</div>
		</div>
	{/if}

	<div class="flex items-center gap-1 {position === 'top' ? '-order-1 flex-col-reverse' : 'flex-col'}">
		<div
			class="flex max-w-28 items-center gap-1 text-base"
		>
			{#if player.isModerator}
				<span title="Moderator" class="shrink-0 text-accent">
					<IconCrown class="size-4" aria-label="Moderator" />
				</span>
			{/if}
			{#if !player.online}
				<IconWifiOff class="size-3.5 shrink-0 text-muted" aria-hidden="true" />
			{/if}
			{#if canMakeModerator || onkick}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger
						title={player.name}
						class="max-w-full cursor-pointer truncate underline-offset-2 hover:text-accent hover:underline {isYou
							? 'font-semibold'
							: 'text-muted'}"
					>
						{player.name}
					</DropdownMenu.Trigger>
					<DropdownMenu.Portal>
						<DropdownMenu.Content
							sideOffset={6}
							class="z-50 min-w-36 rounded-xl border border-line bg-surface p-1 shadow-lg"
						>
							{#if canMakeModerator}
								<DropdownMenu.Item
									class="cursor-pointer rounded-lg px-3 py-2 text-sm data-highlighted:bg-panel"
									onSelect={onmakemoderator}
								>
									Make moderator
								</DropdownMenu.Item>
							{/if}
							{#if onkick}
								<DropdownMenu.Item
									class="cursor-pointer rounded-lg px-3 py-2 text-sm text-danger data-highlighted:bg-panel"
									onSelect={onkick}
								>
									Remove from game
								</DropdownMenu.Item>
							{/if}
						</DropdownMenu.Content>
					</DropdownMenu.Portal>
				</DropdownMenu.Root>
			{:else}
				<span title={player.name} class="max-w-full truncate {isYou ? 'font-semibold' : 'text-muted'}">{player.name}</span>
			{/if}
		</div>
		{#if !player.online}
			<Tooltip.Root>
				<Tooltip.Trigger
					class="inline-flex shrink-0 items-center gap-1 rounded text-xs text-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
				>
					Offline
				</Tooltip.Trigger>
				<Tooltip.Portal>
					<Tooltip.Content role="tooltip" sideOffset={8} class="tooltip-content">
						Disconnected. Seat disappears after 30 seconds.
					</Tooltip.Content>
				</Tooltip.Portal>
			</Tooltip.Root>
		{/if}
	</div>

	{#if revealed && outlier}
		<span class="inline-flex items-center gap-0.5 text-sm font-medium text-accent"
			class:-order-2={position === 'top'}>
			{#if outlier === 'high'}
				<IconArrowUp class="size-3.5" /> highest
			{:else}
				<IconArrowDown class="size-3.5" /> lowest
			{/if}
		</span>
	{/if}
</div>
