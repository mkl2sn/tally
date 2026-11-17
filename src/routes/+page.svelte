<script lang="ts">
	import { goto } from '$app/navigation';
	import { Tooltip } from 'bits-ui';
	import IconHelp from '~icons/lucide/circle-help';
	import Logo from '$lib/components/Logo.svelte';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import GitHubLink from '$lib/components/GitHubLink.svelte';
	import Select from '$lib/components/ui/Select.svelte';
	import Switch from '$lib/components/ui/Switch.svelte';
	import { DECK_PRESETS, MAX_DECK_SIZE, MAX_ROOM_NAME_LENGTH } from '$lib/protocol';
	import posthog from 'posthog-js';

	let roomName = $state('');
	let deckId = $state<string>('fibonacci');
	let customDeck = $state('1, 2, 3, 5, 8, 13, ?');
	let openRoom = $state(true);
	let creating = $state(false);
	let errorMsg = $state('');

	const deckItems = [
		...DECK_PRESETS.map((p) => ({ value: p.id, label: p.label })),
		{ value: 'custom', label: 'Custom deck' }
	];

	const deck = $derived(
		deckId === 'custom'
			? [
					...new Set(
						customDeck
							.split(',')
							.map((c) => c.trim())
							.filter(Boolean)
					)
				].slice(0, MAX_DECK_SIZE)
			: (DECK_PRESETS.find((p) => p.id === deckId)?.cards ?? []).slice()
	);

	async function create(event: SubmitEvent) {
		event.preventDefault();
		creating = true;
		errorMsg = '';
		try {
			const res = await fetch('/api/rooms', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ roomName, deck, moderated: !openRoom })
			});
			if (!res.ok) throw new Error('Could not create the game. Please try again.');
			const { roomId } = (await res.json()) as { roomId: string };
			posthog.capture('game_created', {
				deck_type: deckId,
				deck_size: deck.length,
				is_moderated: !openRoom
			});
			await goto(`/room/${roomId}`);
		} catch (err) {
			errorMsg = err instanceof Error ? err.message : 'Could not create the game.';
			creating = false;
		}
	}
</script>

<svelte:head>
	<title>Tally: real-time planning poker</title>
	<meta
		name="description"
		content="Free real-time planning poker. Create a game, share the link, estimate together. No accounts, no setup."
	/>
	<link rel="canonical" href="https://tallyplanning.com/" />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="Tally" />
	<meta property="og:locale" content="en_US" />
	<meta property="og:url" content="https://tallyplanning.com/" />
	<meta property="og:title" content="Tally: real-time planning poker" />
	<meta
		property="og:description"
		content="Free real-time planning poker. Create a game, share the link, estimate together. No accounts, no setup."
	/>
	<meta property="og:image" content="https://tallyplanning.com/og.png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta name="twitter:card" content="summary_large_image" />
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-3xl flex-col px-4">
	<header class="flex items-center justify-between py-5">
		<Logo size={30} wordmark />
		<ThemeToggle />
	</header>

	<main class="flex flex-1 flex-col justify-center gap-10 pb-16">
		<div class="max-w-xl">
			<h1 class="text-4xl leading-tight font-extrabold tracking-tight sm:text-5xl">
				Get everyone to the <span class="text-accent">same number</span>.
			</h1>
			<p class="mt-4 text-lg text-muted">
				Free real-time planning poker. Create a game, share the link, estimate together. No
				accounts, no setup.
			</p>
		</div>

		<section class="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:p-7">
			<form onsubmit={create} class="grid gap-5">
				<label class="grid gap-1.5">
					<span class="text-sm font-medium">Game name</span>
					<input
						bind:value={roomName}
						required
						maxlength={MAX_ROOM_NAME_LENGTH}
						placeholder="Sprint 42 refinement"
						class="field"
					/>
				</label>

				<div class="grid gap-1.5">
					<span class="text-sm font-medium">Voting system</span>
					<Select bind:value={deckId} items={deckItems} />
				</div>

				{#if deckId === 'custom'}
					<label class="grid gap-1.5">
						<span class="text-sm font-medium">Your cards, separated by commas</span>
						<input bind:value={customDeck} placeholder="1, 2, 3, 5, 8, 13, ?" class="field" />
					</label>
				{/if}

				{#if deck.length > 0}
					<div class="flex flex-wrap gap-1.5" aria-label="Deck preview">
						{#each deck as card (card)}
							<span
								class="inline-flex h-8 min-w-6.5 items-center justify-center rounded-md border border-line bg-panel px-1.5 text-sm font-semibold tabular-nums"
							>
								{card}
							</span>
						{/each}
					</div>
				{/if}

				<Switch bind:checked={openRoom} label="Open game">
					{#snippet labelExtra()}
						<Tooltip.Provider delayDuration={150}>
							<Tooltip.Root>
								<Tooltip.Trigger
									class="cursor-help text-muted hover:text-ink"
									aria-label="What is an open game?"
								>
									<IconHelp class="size-4" />
								</Tooltip.Trigger>
								<Tooltip.Portal>
									<Tooltip.Content
										sideOffset={6}
										class="z-50 max-w-72 rounded-xl border border-line bg-surface p-3 text-sm shadow-lg"
									>
										In an open game there is no moderator, so everyone can manage rounds and
										settings. Turn this off to run the game as its moderator.
									</Tooltip.Content>
								</Tooltip.Portal>
							</Tooltip.Root>
						</Tooltip.Provider>
					{/snippet}
				</Switch>

				{#if errorMsg}
					<p class="text-sm text-danger">{errorMsg}</p>
				{/if}

				<button type="submit" disabled={creating || deck.length < 2} class="btn btn-primary">
					{creating ? 'Setting up the game…' : 'Create game'}
				</button>
			</form>
		</section>

		<ul class="grid gap-4 text-muted sm:grid-cols-3">
			<li>
				<strong class="block font-medium text-ink">Live presence</strong>
				See who's here and who has voted, as it happens.
			</li>
			<li>
				<strong class="block font-medium text-ink">Voting history</strong>
				Every round on the record: average, agreement, distribution.
			</li>
			<li>
				<strong class="block font-medium text-ink">Spectator mode</strong>
				Watch without a hand (for stakeholders and the politely undecided).
			</li>
		</ul>
	</main>

	<footer class="flex flex-col items-start justify-between gap-x-6 gap-y-2 border-t border-line py-4 text-sm text-muted sm:flex-row sm:items-center">
		<p>Tally: planning poker without the ceremony. Rooms expire 30 days after the last activity.</p>
		<GitHubLink />
	</footer>
</div>
