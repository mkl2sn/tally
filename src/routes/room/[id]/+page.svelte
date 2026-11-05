<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
	import { DropdownMenu, Tooltip } from 'bits-ui';
	import IconTimer from '~icons/lucide/timer';
	import IconSettings from '~icons/lucide/settings';
	import IconHistory from '~icons/lucide/history';
	import IconUserPlus from '~icons/lucide/user-plus';
	import IconX from '~icons/lucide/x';
	import IconEye from '~icons/lucide/eye';
	import IconEyeOff from '~icons/lucide/eye-off';
	import Logo from '$lib/components/Logo.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import PlayerSeat from '$lib/components/PlayerSeat.svelte';
	import HistoryModal from '$lib/components/HistoryModal.svelte';
	import Modal from '$lib/components/ui/Modal.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { RoomConnection, storedSession } from '$lib/client/room.svelte';
	import {
		DECK_PRESETS,
		MAX_NAME_LENGTH,
		MAX_ROOM_NAME_LENGTH,
		OFFLINE_GRACE_MS,
		REVEAL_COUNTDOWN_MS,
		countdownDisplaySeconds,
		sanitizeDeck,
		type PlayerView
	} from '$lib/protocol';
	import { voteSpread, outlierFor } from '$lib/scoring';
	import type { PageProps } from './$types';
	import posthog from 'posthog-js';

	let { data }: PageProps = $props();

	let conn = $state<RoomConnection | null>(null);
	let name = $state('');
	let joinAsSpectator = $state(false);
	let historyOpen = $state(false);
	let settingsOpen = $state(false);
	let inviteOpen = $state(false);
	let renameOpen = $state(false);
	let proWaitlistOpen = $state(false);
	let confirmOpenRoom = $state(false);
	let copied = $state(false);
	let nameDraft = $state('');
	let proWaitlistEmail = $state('');
	let proWaitlistUseCase = $state('');
	let proWaitlistSubmitted = $state(false);
	let roomNameDraft = $state('');
	let deckChoice = $state('fibonacci');
	let customDeckDraft = $state('');
	let inviteUrl = $state('');
	let now = $state(Date.now());
	let localCountdownEndsAt = $state<number | null>(null);
	let hideVote = $state(false);
	let peeking = $state(false);
	let peekTimer: ReturnType<typeof setTimeout> | undefined;
	let flashCard = $state<string | null>(null);
	let flashTimer: ReturnType<typeof setTimeout> | undefined;

	onMount(() => {
		name = localStorage.getItem('tally:name') ?? '';
		hideVote = localStorage.getItem('tally:hideVote') === '1';
		inviteUrl = location.href;
		const session = storedSession(data.roomId);
		if (session.playerId && session.secret && name) {
			conn = new RoomConnection(data.roomId, { name, role: session.role ?? 'player' });
		} else {
			posthog.capture('join_screen_viewed', { room_id: data.roomId });
		}
		const interval = setInterval(() => (now = Date.now()), 300);
		return () => clearInterval(interval);
	});

	onDestroy(() => conn?.destroy());

	const snap = $derived(conn?.snapshot ?? null);
	const you = $derived(snap ? (snap.players.find((p) => p.id === snap.you) ?? null) : null);
	const isMod = $derived(you?.isModerator ?? false);
	const canManage = $derived(snap ? !snap.moderated || isMod : false);
	const visiblePlayers = $derived(
		(snap?.players ?? []).filter(
			(p) => p.online || p.id === snap?.you || now - p.lastSeen < OFFLINE_GRACE_MS
		)
	);
	const topSeats = $derived(visiblePlayers.filter((_, i) => i % 2 === 0));
	const bottomSeats = $derived(visiblePlayers.filter((_, i) => i % 2 === 1));
	const activePlayers = $derived(visiblePlayers.filter((p) => p.role === 'player' && p.online));
	const votedCount = $derived(activePlayers.filter((p) => p.hasVoted).length);
	const revealed = $derived(snap?.phase === 'revealed');
	const spread = $derived(revealed && snap?.result ? voteSpread(snap.result.votes) : null);
	// Countdown lokal verankern: Server-Zeitstempel und Browser-Uhr driften
	// auseinander, was sonst den gesamten Versatz auf die erste/letzte Ziffer legt.
	$effect(() => {
		if (snap?.phase === 'countdown') {
			if (localCountdownEndsAt === null) localCountdownEndsAt = Date.now() + REVEAL_COUNTDOWN_MS;
		} else {
			localCountdownEndsAt = null;
		}
	});
	const countdownSeconds = $derived(
		localCountdownEndsAt !== null ? countdownDisplaySeconds(localCountdownEndsAt - now) : null
	);
	const timerRemaining = $derived(
		snap?.timer ? Math.max(0, Math.ceil((snap.timer.endsAt - now) / 1000)) : null
	);
	const moderatorOnline = $derived(snap?.players.some((p) => p.isModerator && p.online) ?? false);
	const canReveal = $derived(
		canManage ||
			(snap?.whoCanReveal === 'all' && you?.role === 'player') ||
			(Array.isArray(snap?.whoCanReveal) && snap.whoCanReveal.includes(snap.you))
	);
	const revealMode = $derived(Array.isArray(snap?.whoCanReveal) ? 'selected' : (snap?.whoCanReveal ?? 'all'));
	const selectedRevealers = $derived(Array.isArray(snap?.whoCanReveal) ? snap.whoCanReveal : []);
	const historyLabel = $derived(
		snap && snap.history.length > 0 ? `History (${snap.history.length})` : 'History'
	);

	const revealModeItems = [
		{ value: 'all', label: 'All players' },
		{ value: 'moderator', label: 'Only the moderator' },
		{ value: 'selected', label: 'Specific players' }
	];

	const deckItems = [
		...DECK_PRESETS.map((p) => ({ value: p.id, label: p.label })),
		{ value: 'custom', label: 'Custom deck' }
	];

	function openSettings() {
		if (!snap) return;
		roomNameDraft = snap.roomName;
		deckChoice =
			DECK_PRESETS.find(
				(p) => p.cards.length === snap.deck.length && p.cards.every((c, i) => c === snap.deck[i])
			)?.id ?? 'custom';
		customDeckDraft = snap.deck.join(', ');
		confirmOpenRoom = false;
		settingsOpen = true;
	}

	function submitRoomName(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = roomNameDraft.trim();
		if (trimmed) conn?.send({ type: 'setRoomName', name: trimmed });
	}

	function chooseDeck(id: string) {
		const preset = DECK_PRESETS.find((p) => p.id === id);
		if (preset) conn?.send({ type: 'setDeck', deck: [...preset.cards] });
	}

	function submitCustomDeck(event: SubmitEvent) {
		event.preventDefault();
		const deck = sanitizeDeck(customDeckDraft.split(','));
		if (deck.length >= 2) conn?.send({ type: 'setDeck', deck });
	}

	function setRevealMode(mode: string) {
		if (mode === revealMode) return;
		conn?.send({
			type: 'setWhoCanReveal',
			value: mode === 'selected' ? selectedRevealers : (mode as 'all' | 'moderator')
		});
	}

	function toggleRevealer(playerId: string, include: boolean) {
		const value = include
			? [...selectedRevealers, playerId]
			: selectedRevealers.filter((id) => id !== playerId);
		conn?.send({ type: 'setWhoCanReveal', value });
	}

	function join(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = name.trim();
		if (!trimmed) return;
		name = trimmed;
		localStorage.setItem('tally:name', trimmed);
		const role = joinAsSpectator ? 'spectator' : 'player';
		conn = new RoomConnection(data.roomId, { name: trimmed, role });
		posthog.capture('game_joined', { role, room_id: data.roomId });
	}

	function toggleVote(card: string) {
		if (!conn || !snap || snap.phase !== 'voting') return;
		const isDeselecting = you?.vote === card;
		conn.vote(isDeselecting ? null : card);
		if (hideVote) {
			// Im Hide-Modus die geklickte Karte kurz aufleuchten lassen, sonst gibt es kein Feedback.
			clearTimeout(flashTimer);
			flashCard = isDeselecting ? null : card;
			flashTimer = setTimeout(() => (flashCard = null), 500);
		}
		if (!isDeselecting) {
			posthog.capture('vote_cast', { deck_size: snap.deck.length, round: snap.round });
		}
	}

	async function copyInvite() {
		await navigator.clipboard.writeText(inviteUrl);
		copied = true;
		setTimeout(() => (copied = false), 1500);
		posthog.capture('invite_link_copied', { room_id: data.roomId });
	}

	function openProWaitlist() {
		proWaitlistOpen = true;
		proWaitlistSubmitted = false;
		posthog.capture('pro_interest_opened', {
			room_id: data.roomId,
			round: snap?.round,
			history_count: snap?.history.length ?? 0,
			active_players: activePlayers.length,
			source: 'room_footer'
		});
	}

	function submitProWaitlist(event: SubmitEvent) {
		event.preventDefault();
		const email = proWaitlistEmail.trim().toLowerCase();
		const useCase = proWaitlistUseCase.trim();
		if (!email) return;

		posthog.identify(email, { email });
		posthog.capture('pro_waitlist_submitted', {
			email,
			use_case: useCase || undefined,
			room_id: data.roomId,
			round: snap?.round,
			history_count: snap?.history.length ?? 0,
			active_players: activePlayers.length,
			source: 'room_footer',
			wants_permanent_rooms: true,
			wants_custom_urls: true,
			wants_password_protection: true,
			wants_persistent_history: true,
			wants_csv_export: true
		});
		proWaitlistSubmitted = true;
		proWaitlistUseCase = '';
	}

	function submitRename(event: SubmitEvent) {
		event.preventDefault();
		const trimmed = nameDraft.trim();
		if (trimmed) {
			name = trimmed;
			conn?.rename(trimmed);
		}
		renameOpen = false;
	}

	function toggleHideVote() {
		hideVote = !hideVote;
		localStorage.setItem('tally:hideVote', hideVote ? '1' : '0');
	}

	// Kurzer Klick schaltet um, Gedrückthalten zeigt die eigene Wahl kurz an (Peek).
	function peekStart() {
		if (!hideVote) return;
		peekTimer = setTimeout(() => (peeking = true), 250);
	}

	function peekEnd() {
		clearTimeout(peekTimer);
		if (peeking) peeking = false;
		else toggleHideVote();
	}

	function peekCancel() {
		clearTimeout(peekTimer);
		peeking = false;
	}

	function formatSeconds(total: number): string {
		const m = Math.floor(total / 60);
		const s = total % 60;
		return `${m}:${String(s).padStart(2, '0')}`;
	}
</script>

{#snippet tallyMarks(total: number, voted: number)}
	<!-- The signature: votes counted as tally strokes, the fifth crosses the group. -->
	<div class="flex flex-wrap items-center justify-center gap-2.5" aria-hidden="true">
		{#each Array.from({ length: Math.ceil(total / 5) }, (_, g) => g) as g (g)}
			{@const size = Math.min(5, total - g * 5)}
			{@const done = Math.max(0, Math.min(size, voted - g * 5))}
			{@const width = size === 5 ? 46 : 6 + size * 10}
			<svg
				{width}
				height="44"
				viewBox="0 0 {width} 44"
				fill="none"
				stroke-width="4.5"
				stroke-linecap="round"
			>
				{#each Array.from({ length: Math.min(size, 4) }, (_, i) => i) as i (i)}
					<path d="M{8 + i * 10} 7v30" class={i < done ? 'stroke-accent' : 'stroke-muted/40'} />
				{/each}
				{#if size === 5}
					<path d="M4 32L42 12" class={done === 5 ? 'stroke-accent' : 'stroke-muted/40'} />
				{/if}
			</svg>
		{/each}
	</div>
{/snippet}

<svelte:head>
	<title>{data.roomName} — Tally</title>
	<meta
		name="description"
		content="You're invited to a planning poker session. Join in one click — no account needed."
	/>
	<meta name="robots" content="noindex" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Tally" />
	<meta property="og:title" content="{data.roomName} — Tally" />
	<meta
		property="og:description"
		content="You're invited to a planning poker session. Join in one click — no account needed."
	/>
	<meta property="og:image" content="https://tallyplanning.com/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

{#if !conn}
	<!-- Join screen -->
	<div class="grid min-h-dvh place-items-center px-4">
		<div class="w-full max-w-md">
			<div class="mb-6 flex justify-center">
				<a href="/" aria-label="Tally home"><Logo size={34} wordmark beta /></a>
			</div>
			<form onsubmit={join} class="grid gap-4 rounded-2xl border border-line bg-surface p-6 shadow-sm">
				<div>
					<h1 class="text-2xl font-bold">{data.roomName}</h1>
					<p class="mt-1 text-sm text-muted">You're invited. What should we call you?</p>
				</div>
				<label class="grid gap-1.5">
					<span class="text-sm font-medium">Your name</span>
					<!-- svelte-ignore a11y_autofocus -->
					<input
						bind:value={name}
						required
						autofocus
						maxlength={MAX_NAME_LENGTH}
						placeholder="Ada Lovelace"
						class="field"
					/>
				</label>
				<Switch bind:checked={joinAsSpectator} label="Join as spectator" />
				<button type="submit" class="btn btn-primary">
					{joinAsSpectator ? 'Watch the game' : 'Join the game'}
				</button>
			</form>
		</div>
	</div>
{:else if conn.closeReason}
	<div class="grid min-h-dvh place-items-center px-4 text-center">
		<div class="flex flex-col items-center">
			<Logo size={34} />
			<p class="mt-4 text-lg">{conn.closeReason}</p>
			<a href="/" class="btn btn-primary mt-4">Start a new game</a>
		</div>
	</div>
{:else if !snap || !you}
	<div class="grid min-h-dvh place-items-center text-muted">Joining…</div>
{:else}
	<div class="flex min-h-dvh flex-col">
		<header class="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-4 py-3">
			<a href="/" aria-label="Tally home" class="shrink-0"><Logo size={26} /></a>
			<h1 class="min-w-0 flex-1 truncate text-lg font-bold">
				{snap.roomName}
				<span
					class="ml-1.5 rounded-full bg-panel px-2 py-0.5 align-middle text-sm font-medium text-muted"
				>
					Round {snap.round}
				</span>
			</h1>

			<div class="flex items-center gap-2">
				{#if snap.timer && timerRemaining !== null}
					<span
						class="rounded-full border border-line px-3 py-1.5 text-sm tabular-nums {timerRemaining ===
						0
							? 'text-danger'
							: ''}"
					>
						{timerRemaining === 0 ? "Time's up" : formatSeconds(timerRemaining)}
						{#if canManage}
							<Tooltip.Root>
								<Tooltip.Trigger
									class="ml-1 align-middle text-muted hover:text-ink"
									onclick={() => conn?.send({ type: 'stopTimer' })}
									aria-label="Stop timer"
								>
									<IconX class="size-3.5" />
								</Tooltip.Trigger>
								<Tooltip.Portal>
									<Tooltip.Content sideOffset={8} class="tooltip-content">
										Stop timer
									</Tooltip.Content>
								</Tooltip.Portal>
							</Tooltip.Root>
						{/if}
					</span>
				{:else if canManage}
					{#snippet timerTrigger({ props: menuProps }: { props: Record<string, unknown> })}
						<Tooltip.Root>
							<Tooltip.Trigger
								{...menuProps}
								class="btn btn-secondary btn-sm btn-icon"
								aria-label="Timer"
							>
								<IconTimer class="size-4" />
							</Tooltip.Trigger>
							<Tooltip.Portal>
								<Tooltip.Content sideOffset={8} class="tooltip-content">Timer</Tooltip.Content>
							</Tooltip.Portal>
						</Tooltip.Root>
					{/snippet}
					<DropdownMenu.Root>
						<DropdownMenu.Trigger child={timerTrigger} />
						<DropdownMenu.Portal>
							<DropdownMenu.Content
								sideOffset={6}
								align="end"
								class="z-50 min-w-28 rounded-xl border border-line bg-surface p-1 shadow-lg"
							>
								{#each [60, 120, 300, 600] as seconds (seconds)}
									<DropdownMenu.Item
										class="cursor-pointer rounded-lg px-3 py-2 text-sm data-highlighted:bg-panel"
										onSelect={() => conn?.send({ type: 'startTimer', seconds })}
									>
										{seconds / 60} min
									</DropdownMenu.Item>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Portal>
					</DropdownMenu.Root>
				{/if}

				{#if canManage}
					<Tooltip.Root>
						<Tooltip.Trigger
							class="btn btn-secondary btn-sm btn-icon"
							onclick={openSettings}
							aria-label="Settings"
						>
							<IconSettings class="size-4" />
						</Tooltip.Trigger>
						<Tooltip.Portal>
							<Tooltip.Content sideOffset={8} class="tooltip-content">Settings</Tooltip.Content>
						</Tooltip.Portal>
					</Tooltip.Root>
				{/if}

				<Tooltip.Root>
					<Tooltip.Trigger
						class="btn btn-secondary btn-sm btn-icon"
						onclick={() => {
							historyOpen = true;
							posthog.capture('history_opened', {
								room_id: data.roomId,
								history_count: snap.history.length
							});
						}}
						aria-label={historyLabel}
					>
						<IconHistory class="size-4" />
					</Tooltip.Trigger>
					<Tooltip.Portal>
						<Tooltip.Content sideOffset={8} class="tooltip-content">{historyLabel}</Tooltip.Content>
					</Tooltip.Portal>
				</Tooltip.Root>
				<button class="btn btn-primary btn-sm" onclick={() => (inviteOpen = true)}>
					<IconUserPlus class="size-4" /> Invite
				</button>
				<ThemeToggle />
			</div>
		</header>

		{#if conn.status === 'reconnecting'}
			<div class="bg-danger px-4 py-1.5 text-center text-sm text-white">
				Connection lost — reconnecting…
			</div>
		{/if}

		<main class="flex flex-1 flex-col items-center justify-center gap-5 px-4 py-6">
			<div class="flex min-h-24 flex-wrap items-end justify-center gap-3">
				{#each topSeats as player (player.id)}
					<PlayerSeat
						{player}
						{revealed}
						isYou={player.id === snap.you}
						outlier={outlierFor(player.vote, spread)}
						canMakeModerator={isMod && player.id !== snap.you}
						onmakemoderator={() => conn?.send({ type: 'transferModerator', playerId: player.id })}
						onkick={isMod && player.id !== snap.you
							? () => conn?.send({ type: 'kick', playerId: player.id })
							: undefined}
					/>
				{/each}
			</div>

			<!-- The stage -->
			<div
				class="flex min-h-52 w-full max-w-2xl flex-col items-center justify-center gap-4 rounded-3xl border border-line bg-panel px-8 py-8"
			>
				{#if countdownSeconds !== null}
					{#key countdownSeconds}
						<div class="pulse-count text-7xl font-extrabold tracking-tight">
							{countdownSeconds}
						</div>
					{/key}
				{:else if revealed && snap.result}
					{@const ringLength = 2 * Math.PI * 44}
					<div class="flex items-center gap-10">
						{#if snap.showAverage}
							<div class="text-center">
								<div class="mx-auto grid size-24 place-items-center">
									<div class="text-3xl font-extrabold tracking-tight tabular-nums">
										{snap.result.average ?? '–'}
									</div>
								</div>
								<div class="mt-1 text-sm text-muted">average</div>
							</div>
							<div class="text-center">
								<div class="mx-auto grid size-24 place-items-center">
									<div class="text-3xl font-extrabold tracking-tight tabular-nums">
										{snap.result.median ?? '–'}
									</div>
								</div>
								<div class="mt-1 text-sm text-muted">median</div>
							</div>
						{/if}
						<div class="text-center">
							<div class="relative mx-auto size-24">
								<svg viewBox="0 0 100 100" class="size-full -rotate-90">
									<circle cx="50" cy="50" r="44" fill="none" stroke="var(--line)" stroke-width="8" />
									<circle
										cx="50"
										cy="50"
										r="44"
										fill="none"
										stroke="hsl({snap.result.agreement * 120} 65% 42%)"
										stroke-width="8"
										stroke-linecap="round"
										stroke-dasharray="{ringLength * snap.result.agreement} {ringLength}"
									/>
								</svg>
								<div
									class="absolute inset-0 grid place-items-center text-3xl font-extrabold tracking-tight tabular-nums"
								>
									{Math.round(snap.result.agreement * 100)}%
								</div>
							</div>
							<div class="mt-1 text-sm text-muted">
								{snap.result.agreement === 1 ? 'unanimous' : 'agreement'}
							</div>
						</div>
					</div>
					<div class="flex flex-wrap justify-center gap-1.5">
						{#each snap.result.distribution as { card, count } (card)}
							<span
								class="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2 py-0.5 text-sm font-semibold"
							>
								{card} <span class="text-sm font-normal text-muted">×{count}</span>
							</span>
						{/each}
					</div>
					{#if canManage}
						<button
							class="btn btn-primary mt-1"
							onclick={() => {
								conn?.send({ type: 'newRound' });
								posthog.capture('new_round_started', {
									room_id: data.roomId,
									round: snap?.round
								});
							}}
						>
							Start next round
						</button>
					{/if}
				{:else}
					{#if activePlayers.length <= 1 && votedCount === 0}
						<p class="text-center text-sm text-muted">
							It's quiet in here. Share the link to get the votes going.
						</p>
						<button class="btn btn-secondary btn-sm" onclick={() => (inviteOpen = true)}>
							Invite your team
						</button>
					{:else}
						{@render tallyMarks(activePlayers.length, votedCount)}
						<p class="text-sm text-muted">{votedCount} of {activePlayers.length} voted</p>
					{/if}
					{#if canReveal}
						<button
							class="btn btn-primary"
							disabled={votedCount === 0}
							onclick={() => {
								conn?.send({ type: 'reveal' });
								posthog.capture('cards_revealed', {
									room_id: data.roomId,
									round: snap?.round,
									voted_count: votedCount,
									total_players: activePlayers.length
								});
							}}
						>
							Reveal cards
						</button>
					{/if}
					{#if snap.moderated && !isMod && !moderatorOnline}
						<button
							class="btn btn-secondary btn-sm"
							onclick={() => conn?.send({ type: 'claimModerator' })}
						>
							Moderator left — take over
						</button>
					{/if}
				{/if}
			</div>

			<div class="flex min-h-24 flex-wrap items-start justify-center gap-3">
				{#each bottomSeats as player (player.id)}
					<PlayerSeat
						{player}
						{revealed}
						isYou={player.id === snap.you}
						outlier={outlierFor(player.vote, spread)}
						canMakeModerator={isMod && player.id !== snap.you}
						onmakemoderator={() => conn?.send({ type: 'transferModerator', playerId: player.id })}
						onkick={isMod && player.id !== snap.you
							? () => conn?.send({ type: 'kick', playerId: player.id })
							: undefined}
					/>
				{/each}
			</div>
		</main>

		<footer class="sticky bottom-0 border-t border-line bg-surface/95 px-4 py-3 backdrop-blur">
			{#if you.role === 'player'}
				<div
					class="mx-auto flex max-w-4xl flex-wrap items-end justify-center gap-2 {snap.phase ===
					'voting'
						? ''
						: 'pointer-events-none opacity-50'}"
				>
					{#each snap.deck as card (card)}
						<button
							class="h-16 w-11 rounded-xl border text-lg font-bold transition-transform tabular-nums {(you.vote ===
								card &&
								(!hideVote || peeking)) ||
							flashCard === card
								? '-translate-y-2 border-accent bg-accent text-accent-ink shadow-lg'
								: 'border-line bg-surface hover:-translate-y-1 hover:border-accent'}"
							onclick={() => toggleVote(card)}
							aria-pressed={you.vote === card}
						>
							{card}
						</button>
					{/each}
					<Tooltip.Root>
						<Tooltip.Trigger
							class="btn btn-secondary btn-sm btn-icon self-center"
							aria-label={hideVote ? 'Show your pick' : 'Hide your pick'}
							aria-pressed={hideVote}
							onpointerdown={peekStart}
							onpointerup={peekEnd}
							onpointerleave={peekCancel}
							onclick={(e) => e.detail === 0 && toggleHideVote()}
						>
							{#if hideVote}
								<IconEyeOff class="size-4" />
							{:else}
								<IconEye class="size-4" />
							{/if}
						</Tooltip.Trigger>
						<Tooltip.Portal>
							<Tooltip.Content sideOffset={8} class="tooltip-content">
								{hideVote ? 'Pick hidden. Hold to peek, click to show' : 'Hide your pick from neighbors'}
							</Tooltip.Content>
						</Tooltip.Portal>
					</Tooltip.Root>
				</div>
			{:else}
				<p class="text-center text-sm text-muted">
					You're watching this game.
					<button
						class="ml-1 font-medium text-ink underline underline-offset-2"
						onclick={() => conn?.setRole('player')}
					>
						Join the game
					</button>
				</p>
			{/if}

			<div class="mx-auto mt-2 flex max-w-4xl items-center justify-center gap-3 text-sm text-muted">
				<span>
					Playing as <strong class="text-ink">{you.name}</strong>
					<button
						class="ml-1 underline underline-offset-2 hover:text-ink"
						onclick={() => {
							nameDraft = you?.name ?? '';
							renameOpen = true;
						}}
					>
						edit
					</button>
				</span>
				{#if you.role === 'player'}
					<span aria-hidden="true">·</span>
					<button
						class="underline underline-offset-2 hover:text-ink"
						onclick={() => conn?.setRole('spectator')}
					>
						Switch to spectator
					</button>
				{/if}
			</div>
			<div class="mx-auto mt-1 max-w-4xl text-center text-xs text-muted">
				Need a room your team can reuse?
				<button class="underline underline-offset-2 hover:text-ink" onclick={openProWaitlist}>
					Join the Pro waitlist
				</button>
			</div>
		</footer>
	</div>

	<HistoryModal history={snap.history} showAverage={snap.showAverage} bind:open={historyOpen} />

	{#if canManage}
		<Modal bind:open={settingsOpen} title="Game settings">
			<div class="grid gap-4">
				<form onsubmit={submitRoomName} class="grid gap-1.5">
					<span class="text-sm font-medium">Game name</span>
					<div class="flex gap-2">
						<input
							bind:value={roomNameDraft}
							required
							maxlength={MAX_ROOM_NAME_LENGTH}
							class="field"
						/>
						<button
							type="submit"
							class="btn btn-secondary btn-sm shrink-0"
							disabled={roomNameDraft.trim() === snap.roomName || !roomNameDraft.trim()}
						>
							Save
						</button>
					</div>
				</form>
				<div class="grid gap-1.5">
					<span class="text-sm font-medium">Voting system</span>
					<Select bind:value={deckChoice} items={deckItems} onValueChange={chooseDeck} />
					{#if deckChoice === 'custom'}
						<form onsubmit={submitCustomDeck} class="flex gap-2">
							<input
								bind:value={customDeckDraft}
								placeholder="1, 2, 3, 5, 8, 13, ?"
								class="field"
							/>
							<button
								type="submit"
								class="btn btn-secondary btn-sm shrink-0"
								disabled={sanitizeDeck(customDeckDraft.split(',')).length < 2}
							>
								Apply
							</button>
						</form>
					{/if}
					<div class="flex flex-wrap gap-1.5" aria-label="Current deck">
						{#each snap.deck as card (card)}
							<span
								class="inline-flex h-8 min-w-6.5 items-center justify-center rounded-md border border-line bg-panel px-1.5 text-sm font-semibold tabular-nums"
							>
								{card}
							</span>
						{/each}
					</div>
				</div>
				{#if snap.moderated}
					<div class="grid gap-1.5">
						<span class="text-sm font-medium">Who can reveal cards</span>
						<Select value={revealMode} items={revealModeItems} onValueChange={setRevealMode} />
					</div>
					{#if revealMode === 'selected'}
						<div class="grid gap-2 rounded-xl border border-line bg-panel p-3">
							{#each snap.players.filter((p) => p.role === 'player' && !p.isModerator) as player (player.id)}
								<label class="flex cursor-pointer items-center gap-2 text-sm">
									<input
										type="checkbox"
										class="accent-accent size-4"
										checked={selectedRevealers.includes(player.id)}
										onchange={(e) => toggleRevealer(player.id, e.currentTarget.checked)}
									/>
									<span class="truncate">{player.name}</span>
								</label>
							{:else}
								<p class="text-sm text-muted">No other players yet.</p>
							{/each}
							<p class="text-sm text-muted">You can always reveal as the moderator.</p>
						</div>
					{/if}
				{/if}
				<Switch
					checked={snap.autoReveal}
					onCheckedChange={(value) => conn?.send({ type: 'setAutoReveal', value })}
					label="Reveal automatically when everyone voted"
				/>
				<Switch
					checked={snap.revealCountdown}
					onCheckedChange={(value) => conn?.send({ type: 'setRevealCountdown', value })}
					label="3-2-1 countdown before reveal"
				/>
				<Switch
					checked={snap.showAverage}
					onCheckedChange={(value) => conn?.send({ type: 'setShowAverage', value })}
					label="Show average and median in the results"
				/>
				{#if snap.moderated}
					<div class="grid gap-1.5 border-t border-line pt-4">
						<span class="text-sm font-medium">Open game</span>
						<p class="text-sm text-muted">
							Remove the moderator role for good — everyone can manage the game. This cannot be
							undone.
						</p>
						{#if confirmOpenRoom}
							<div class="flex gap-2">
								<button
									class="btn btn-secondary btn-sm text-danger"
									onclick={() => conn?.send({ type: 'openRoom' })}
								>
									Yes, open it forever
								</button>
								<button class="btn btn-secondary btn-sm" onclick={() => (confirmOpenRoom = false)}>
									Cancel
								</button>
							</div>
						{:else}
							<button
								class="btn btn-secondary btn-sm justify-self-start"
								onclick={() => (confirmOpenRoom = true)}
							>
								Open the game…
							</button>
						{/if}
					</div>
				{/if}
			</div>
		</Modal>
	{/if}

	<Modal bind:open={inviteOpen} title="Invite your team">
		<p class="text-sm text-muted">Anyone with this link can join the game.</p>
		<div class="mt-3 flex gap-2">
			<input readonly value={inviteUrl} class="field text-sm" onfocus={(e) => e.currentTarget.select()} />
			<button class="btn btn-primary btn-sm shrink-0" onclick={copyInvite}>
				{copied ? 'Copied!' : 'Copy link'}
			</button>
		</div>
	</Modal>

	<Modal bind:open={renameOpen} title="Change your name">
		<form onsubmit={submitRename} class="flex gap-2">
			<input bind:value={nameDraft} required maxlength={MAX_NAME_LENGTH} class="field" />
			<button type="submit" class="btn btn-primary btn-sm shrink-0">Save</button>
		</form>
	</Modal>

	<Modal bind:open={proWaitlistOpen} title="Need a reusable room?">
		<div class="grid gap-4">
			<div class="grid gap-3 text-sm text-muted">
				<p>I am exploring Tally Pro for teams that want:</p>
				<ul class="list-disc space-y-1 pl-5">
					<li>Permanent rooms</li>
					<li>Custom URLs</li>
					<li>Password protection</li>
					<li>Persistent history</li>
					<li>CSV export</li>
				</ul>
			</div>

			{#if proWaitlistSubmitted}
				<div class="rounded-xl border border-line bg-panel p-4 text-sm">
					<p class="font-medium text-ink">Thanks, you are on the list.</p>
					<p class="mt-1 text-muted">I will only use your email to follow up about Tally Pro.</p>
				</div>
			{:else}
				<form onsubmit={submitProWaitlist} class="grid gap-3">
					<label class="grid gap-1.5">
						<span class="text-sm font-medium">Email</span>
						<input
							bind:value={proWaitlistEmail}
							required
							type="email"
							placeholder="you@company.com"
							class="field"
						/>
					</label>
					<label class="grid gap-1.5">
						<span class="text-sm font-medium">What would you use it for? <span class="text-muted">Optional</span></span>
						<textarea
							bind:value={proWaitlistUseCase}
							rows="3"
							placeholder="Team refinement, client planning, recurring sprint poker..."
							class="field resize-none"
						></textarea>
					</label>
					<p class="text-xs text-muted">
						I will only use your email to follow up about Tally Pro. No spam.
					</p>
					<button type="submit" class="btn btn-primary">Join the waitlist</button>
				</form>
			{/if}
		</div>
	</Modal>
{/if}
