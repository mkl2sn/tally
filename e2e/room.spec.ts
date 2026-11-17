import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

async function createRoom(request: APIRequestContext, overrides: Record<string, unknown> = {}) {
	const res = await request.post('/api/rooms', {
		data: {
			roomName: 'E2E Room',
			deck: ['1', '2', '3', '5', '8'],
			revealCountdown: false,
			...overrides
		}
	});
	expect(res.ok()).toBe(true);
	const { roomId } = (await res.json()) as { roomId: string };
	return roomId;
}

async function joinRoom(page: Page, roomId: string, name: string) {
	await page.goto(`/room/${roomId}`);
	await page.getByLabel('Your name').fill(name);
	await page.getByRole('button', { name: 'Join the game' }).click();
	await expect(page.getByText(`Playing as ${name}`)).toBeVisible();
}

/** One player per browser context: separate localStorage, separate websocket. */
async function twoPlayers(browser: Browser, roomId: string) {
	const contextA = await browser.newContext();
	const contextB = await browser.newContext();
	const alice = await contextA.newPage();
	const bob = await contextB.newPage();
	await joinRoom(alice, roomId, 'Alice');
	await joinRoom(bob, roomId, 'Bob');
	return { alice, bob, close: () => Promise.all([contextA.close(), contextB.close()]) };
}

const seatOf = (page: Page, name: string) => page.locator('.deal-in', { hasText: name });

test('the join form waits for hydration before accepting input', async ({ page, request }) => {
	const roomId = await createRoom(request);
	let releaseScripts!: () => void;
	const scriptsReady = new Promise<void>((resolve) => (releaseScripts = resolve));
	await page.route('**/_app/immutable/**/*.js', async (route) => {
		await scriptsReady;
		await route.continue();
	});

	await page.goto(`/room/${roomId}`, { waitUntil: 'commit' });
	try {
		await expect(page.getByLabel('Your name')).toBeDisabled();
		await expect(page.getByRole('button', { name: 'Join the game' })).toBeDisabled();
	} finally {
		releaseScripts();
	}

	await page.getByLabel('Your name').fill('Alice');
	await page.getByRole('button', { name: 'Join the game' }).click();
	await expect(page.getByText('Playing as Alice')).toBeVisible();
});

test('two players join and see each other', async ({ browser, request }) => {
	const roomId = await createRoom(request);
	const { alice, bob, close } = await twoPlayers(browser, roomId);

	await expect(alice.getByRole('heading', { name: /E2E Room/ })).toBeVisible();
	await expect(seatOf(alice, 'Bob')).toBeVisible();
	await expect(seatOf(bob, 'Alice')).toBeVisible();
	await close();
});

test('a vote is visible as "voted" but the card stays hidden', async ({ browser, request }) => {
	const roomId = await createRoom(request);
	const { alice, bob, close } = await twoPlayers(browser, roomId);

	await alice.getByRole('button', { name: '5', exact: true }).click();

	await expect(bob.getByText('1 of 2 voted')).toBeVisible();
	const aliceSeat = seatOf(bob, 'Alice');
	await expect(aliceSeat.locator('.card-back-tally')).toBeVisible();
	await expect(aliceSeat).not.toContainText('5');
	await close();
});

test('revealing shows the same result to everyone', async ({ browser, request }) => {
	const roomId = await createRoom(request);
	const { alice, bob, close } = await twoPlayers(browser, roomId);

	await alice.getByRole('button', { name: '5', exact: true }).click();
	await bob.getByRole('button', { name: '8', exact: true }).click();
	await expect(alice.getByText('2 of 2 voted')).toBeVisible();
	await alice.getByRole('button', { name: 'Reveal cards' }).click();

	for (const page of [alice, bob]) {
		await expect(page.getByText('average')).toBeVisible();
		// average and median of [5, 8] are both 6.5
		await expect(page.getByText('6.5')).toHaveCount(2);
		await expect(seatOf(page, 'Alice')).toContainText('5');
		await expect(seatOf(page, 'Bob')).toContainText('8');
	}
	await close();
});

test('a reload keeps identity and vote', async ({ page, request }) => {
	const roomId = await createRoom(request);
	await joinRoom(page, roomId, 'Alice');

	await page.getByRole('button', { name: '3', exact: true }).click();
	await expect(page.getByRole('button', { name: '3', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);

	await page.reload();

	// Rejoins from the stored session: no join form, same name, vote intact.
	await expect(page.getByText('Playing as Alice')).toBeVisible();
	await expect(page.getByLabel('Your name')).toHaveCount(0);
	await expect(page.getByRole('button', { name: '3', exact: true })).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await expect(page.getByText('1 of 1 voted')).toBeVisible();
});

test('a kicked player is removed and cannot rejoin', async ({ browser, request }) => {
	const roomId = await createRoom(request, { moderated: true });
	const { alice, bob, close } = await twoPlayers(browser, roomId);

	// Alice joined first, so she is the moderator and can kick Bob.
	await seatOf(alice, 'Bob').getByText('Bob').click();
	await alice.getByText('Remove from game').click();

	await expect(bob.getByText('The moderator removed you from this game.')).toBeVisible();
	await expect(seatOf(alice, 'Bob')).toHaveCount(0);

	// The stored session is banned: rejoining fails.
	await bob.reload();
	await expect(bob.getByText('You were removed from this game.')).toBeVisible();
	await close();
});

test('seat labels face away from the table and keep cards aligned', async ({
	browser,
	request
}) => {
	const roomId = await createRoom(request, {
		roomName: 'Sprint planning',
		deck: ['0', '1', '2', '3', '5', '8', '13', '21', '?']
	});
	const names = ['Alex', 'Jamie', 'Sam', 'Taylor', 'Morgan', 'Jordan'];
	const contexts = await Promise.all(names.map(() => browser.newContext({ deviceScaleFactor: 2 })));
	const pages: Page[] = [];
	try {
		for (const [index, name] of names.entries()) {
			const page = await contexts[index].newPage();
			await joinRoom(page, roomId, name);
			pages.push(page);
		}
		const host = pages[0];
		await host.setViewportSize({ width: 1280, height: 800 });
		for (const votes of [
			['5', '5', '3', '8', '5', '5'],
			['5', '5', '8', '3', '5', '5']
		]) {
			for (const [index, vote] of votes.entries()) {
				await pages[index].getByRole('button', { name: vote, exact: true }).click();
			}
			await expect(host.getByText('6 of 6 voted')).toBeVisible();
			await host.getByRole('button', { name: 'Reveal cards' }).click();
			await expect(seatOf(host, 'Sam')).toContainText(votes[2] === '3' ? 'lowest' : 'highest');
			await expect(seatOf(host, 'Taylor')).toContainText(votes[3] === '3' ? 'lowest' : 'highest');
			for (const row of [
				names.filter((_, index) => index % 2 === 0),
				names.filter((_, index) => index % 2 === 1)
			]) {
				const cards = await Promise.all(
					row.map((name) => seatOf(host, name).locator('.flip-scene').boundingBox())
				);
				expect(
					Math.max(...cards.map((card) => card!.y)) - Math.min(...cards.map((card) => card!.y))
				).toBeLessThan(1);
			}
			const samCard = await seatOf(host, 'Sam').locator('.flip-scene').boundingBox();
			const samLabel = await seatOf(host, 'Sam')
				.getByText(/lowest|highest/)
				.boundingBox();
			expect(samLabel!.y + samLabel!.height).toBeLessThanOrEqual(samCard!.y);
			const taylorName = await seatOf(host, 'Taylor')
				.getByText('Taylor', { exact: true })
				.boundingBox();
			const taylorLabel = await seatOf(host, 'Taylor')
				.getByText(/lowest|highest/)
				.boundingBox();
			expect(taylorLabel!.y).toBeGreaterThanOrEqual(taylorName!.y + taylorName!.height);
			if (process.env.UPDATE_README_SCREENSHOT && votes[2] === '3') {
				await host.evaluate(() => document.fonts.ready);
				await host.screenshot({
					path: 'docs/images/tally-demo.png',
					scale: 'device',
					animations: 'disabled'
				});
			}
			await host.getByRole('button', { name: 'Start next round' }).click();
		}
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});
