<script lang="ts">
	import { DropdownMenu } from 'bits-ui';
	import IconCrown from '~icons/lucide/crown';
	import IconEye from '~icons/lucide/eye';
	import type { PlayerView } from '$lib/protocol';

	let {
		player,
		revealed,
		isYou,
		canMakeModerator = false,
		onmakemoderator
	}: {
		player: PlayerView;
		revealed: boolean;
		isYou: boolean;
		canMakeModerator?: boolean;
		onmakemoderator?: () => void;
	} = $props();

	const flipped = $derived(revealed && player.vote !== null);
</script>

<div class="deal-in flex w-16 flex-col items-center gap-1.5 {player.online ? '' : 'opacity-40'}">
	{#if player.role === 'spectator'}
		<div
			class="flex h-14 w-10 items-center justify-center rounded-lg border border-dashed border-line text-muted"
			title="{player.name} is watching"
		>
			<IconEye class="size-4" />
		</div>
	{:else}
		<div class="flip-scene h-14 w-10">
			<div class="flip-inner relative h-full w-full" class:flipped>
				<div class="flip-front absolute inset-0">
					{#if player.hasVoted}
						<div class="card-back-tally h-full w-full rounded-lg shadow-sm"></div>
					{:else}
						<div class="h-full w-full rounded-lg border-2 border-dashed border-line"></div>
					{/if}
				</div>
				<div
					class="flip-back absolute inset-0 flex items-center justify-center rounded-lg bg-accent-soft text-lg font-bold text-accent tabular-nums shadow-sm"
				>
					{player.vote ?? ''}
				</div>
			</div>
		</div>
	{/if}

	<div class="flex max-w-28 items-center gap-1 text-base" title={player.name}>
		{#if player.isModerator}
			<span title="Moderator" class="shrink-0 text-accent">
				<IconCrown class="size-4" aria-label="Moderator" />
			</span>
		{/if}
		{#if canMakeModerator}
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
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
						<DropdownMenu.Item
							class="cursor-pointer rounded-lg px-3 py-2 text-sm data-highlighted:bg-panel"
							onSelect={onmakemoderator}
						>
							Make moderator
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Portal>
			</DropdownMenu.Root>
		{:else}
			<span class="max-w-full truncate {isYou ? 'font-semibold' : 'text-muted'}">{player.name}</span>
		{/if}
	</div>

	{#if !player.online}
		<span class="text-sm text-muted">away</span>
	{/if}
</div>
