import { expect, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';
import type { ServerMessage } from '../src/lib/protocol';

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

test('closing a tab marks the player offline and removes their seat without room activity', async ({
	browser,
	request
}, testInfo) => {
	test.setTimeout(45_000);
	const roomId = await createRoom(request);
	const { alice, bob, close } = await twoPlayers(browser, roomId);
	try {
		await expect(seatOf(alice, 'Bob')).toBeVisible();
		await bob.close();
		const seat = seatOf(alice, 'Bob');
		await expect(seat.getByRole('button', { name: 'Offline' })).toBeVisible();
		await expect(seat).not.toHaveClass(/opacity-40/);
		await expect(seat.locator('.flip-scene')).toHaveClass(/opacity-40/);
		await seat.getByRole('button', { name: 'Offline' }).focus();
		await expect(alice.getByRole('tooltip')).toContainText('Seat disappears after 30 seconds');
		await alice.screenshot({ path: testInfo.outputPath('player-offline.png') });
		await expect(seatOf(alice, 'Bob')).toHaveCount(0, { timeout: 35_000 });
	} finally {
		await close();
	}
});

test('offline status stays readable beside revealed outliers across themes and screen sizes', async ({
	browser,
	request
}, testInfo) => {
	const roomId = await createRoom(request);
	const { alice, bob, close } = await twoPlayers(browser, roomId);
	const carol = await browser.newPage();
	const errors: string[] = [];
	alice.on('pageerror', (error) => errors.push(error.message));
	try {
		await joinRoom(carol, roomId, 'Carol');
		await carol.getByRole('button', { name: '5', exact: true }).click();
		await alice.getByRole('button', { name: '3', exact: true }).click();
		await bob.getByRole('button', { name: '8', exact: true }).click();
		await expect(alice.getByText('3 of 3 voted')).toBeVisible();
		await alice.getByRole('button', { name: 'Reveal cards' }).click();
		await expect(seatOf(alice, 'Bob')).toContainText('highest');
		await bob.close();
		const seat = seatOf(alice, 'Bob');
		await expect(seat.getByRole('button', { name: 'Offline' })).toBeVisible();
		await expect(seat).toContainText('highest');
		await expect(seat.getByText('Bob', { exact: true })).toHaveCSS('opacity', '1');
		await expect(seat.locator('.flip-scene')).toHaveCSS('opacity', '0.4');
		for (const theme of ['light', 'dark']) {
			if (theme === 'dark')
				await alice.getByRole('button', { name: 'Switch to dark mode' }).click();
			for (const width of [320, 768, 1440]) {
				await alice.setViewportSize({ width, height: 1100 });
				await alice.emulateMedia({ reducedMotion: 'reduce' });
				const status = seat.getByRole('button', { name: 'Offline' });
				await alice.keyboard.press('Tab');
				await status.focus();
				await expect(alice.getByRole('tooltip')).toContainText('Disconnected');
				await expect(status).toBeInViewport();
				await alice.screenshot({ path: testInfo.outputPath(`offline-${theme}-${width}.png`) });
			}
		}
		expect(errors).toEqual([]);
	} finally {
		await close();
		await carol.close();
	}
});

test('offline labels sit outside names and keep cards aligned on both sides of the table', async ({
	browser,
	request
}, testInfo) => {
	const roomId = await createRoom(request);
	const { alice, bob, close } = await twoPlayers(browser, roomId);
	const carol = await browser.newPage();
	const dave = await browser.newPage();
	try {
		await alice.emulateMedia({ reducedMotion: 'reduce' });
		await joinRoom(carol, roomId, 'Carol');
		await joinRoom(dave, roomId, 'Dave');
		await bob.close();
		await carol.close();
		for (const width of [320, 768, 1440]) {
			await alice.setViewportSize({ width, height: 1100 });
			for (const [name, neighbor, position] of [
				['Carol', 'Alice', 'top'],
				['Bob', 'Dave', 'bottom']
			]) {
				const seat = seatOf(alice, name);
				const status = seat.getByRole('button', { name: 'Offline' });
				await expect(status).toBeVisible();
				const label = await status.boundingBox();
				const playerName = await seat.getByText(name, { exact: true }).boundingBox();
				const card = await seat.locator('.flip-scene').boundingBox();
				const neighborCard = await seatOf(alice, neighbor).locator('.flip-scene').boundingBox();
				expect(card!.y).toBeCloseTo(neighborCard!.y, 0);
				expect(label!.x + label!.width / 2).toBeCloseTo(card!.x + card!.width / 2, 0);
				if (position === 'top') {
					expect(label!.y + label!.height).toBeLessThanOrEqual(playerName!.y);
					expect(playerName!.y + playerName!.height).toBeLessThanOrEqual(card!.y);
				} else {
					expect(card!.y + card!.height).toBeLessThanOrEqual(playerName!.y);
					expect(playerName!.y + playerName!.height).toBeLessThanOrEqual(label!.y);
				}
			}
			await alice.screenshot({ path: testInfo.outputPath(`offline-placement-${width}.png`) });
		}
	} finally {
		await close();
		await carol.close();
		await dave.close();
	}
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

for (const minutes of [1, 2, 3, 4, 5]) {
	test(`a ${minutes} minute timer starts at its configured duration`, async ({ page, request }) => {
		const roomId = await createRoom(request);
		let endsAt = 0;
		page.on('websocket', (socket) => {
			socket.on('framereceived', ({ payload }) => {
				const message = JSON.parse(payload.toString()) as ServerMessage;
				if (message.type === 'state' && message.state.timer) {
					endsAt = message.state.timer.endsAt;
				}
			});
		});
		await joinRoom(page, roomId, 'Alice');

		// Keep the displayed clock behind the server, as between the 300 ms updates.
		await page.clock.setFixedTime(new Date(Date.now() - 200));
		await page.getByRole('button', { name: 'Timer', exact: true }).click();
		await expect(page.getByRole('menuitem')).toHaveText([
			'1 min',
			'2 min',
			'3 min',
			'4 min',
			'5 min'
		]);
		await page.getByRole('menuitem', { name: `${minutes} min`, exact: true }).click();

		const panel = page.getByRole('region', { name: 'Session timer' });
		const timer = panel.getByRole('timer', { name: 'Time remaining' });
		await expect(timer).toHaveText(`${minutes}:00`);
		await expect(page.getByRole('button', { name: 'Timer', exact: true })).toHaveCount(0);

		await page.clock.setFixedTime(new Date(endsAt - (minutes * 60 - 1) * 1000));
		await expect(timer).toHaveText(`${minutes - 1}:59`);
		await page.clock.setFixedTime(new Date(endsAt - 10_000));
		await expect(panel.getByRole('status')).toHaveText('Ending soon');
		await expect(timer).toHaveText('0:10');
		await page.clock.setFixedTime(new Date(endsAt - 1));
		await expect(timer).toHaveText('0:01');
		await page.clock.setFixedTime(new Date(endsAt));
		await expect(timer).toHaveText('0:00');
		await expect(panel.getByRole('status')).toHaveText("Time's up");
		await page.getByRole('button', { name: 'Stop timer', exact: true }).click();
		await expect(page.getByRole('button', { name: 'Timer', exact: true })).toBeVisible();
	});
}

test('timer completion stays visible to every player across screen sizes and themes', async ({
	browser,
	request
}, testInfo) => {
	const roomId = await createRoom(request, { moderated: true });
	const { alice, bob, close } = await twoPlayers(browser, roomId);
	const errors: string[] = [];
	for (const page of [alice, bob]) {
		page.on('pageerror', (error) => errors.push(error.message));
	}
	try {
		await alice.setViewportSize({ width: 1440, height: 900 });
		await bob.emulateMedia({ reducedMotion: 'reduce' });
		for (const page of [alice, bob]) {
			await page.clock.setFixedTime(new Date(Date.now() - 200));
		}
		await alice.getByRole('button', { name: 'Timer', exact: true }).click();
		await alice.getByRole('menuitem', { name: '1 min', exact: true }).click();
		for (const page of [alice, bob]) {
			await expect(page.getByRole('region', { name: 'Session timer' })).toBeVisible();
		}
		await expect(bob.getByRole('button', { name: 'Stop timer' })).toHaveCount(0);
		await expect(bob.getByRole('button', { name: 'Add 30 seconds' })).toHaveCount(0);
		await expect(bob.getByRole('button', { name: 'Remove 30 seconds' })).toHaveCount(0);
		await alice.getByRole('button', { name: 'Add 30 seconds' }).click();
		for (const page of [alice, bob]) {
			await expect(page.getByRole('timer', { name: 'Time remaining' })).toHaveText('1:30');
		}
		await alice.getByRole('button', { name: 'Remove 30 seconds' }).click();
		for (const page of [alice, bob]) {
			await expect(page.getByRole('timer', { name: 'Time remaining' })).toHaveText('1:00');
		}
		await alice.screenshot({
			path: testInfo.outputPath('timer-running.png'),
			animations: 'disabled'
		});

		for (const page of [alice, bob]) {
			await page.clock.setFixedTime(new Date(Date.now() + 61_000));
			await expect(page.getByRole('status')).toHaveText("Time's up");
			await expect(page.getByRole('timer', { name: 'Time remaining' })).toHaveText('0:00');
		}
		await expect(alice.getByRole('button', { name: 'Remove 30 seconds' })).toHaveCount(0);
		await expect(alice.getByRole('button', { name: 'Add 30 seconds' })).toHaveCount(0);
		for (const width of [320, 768, 1024, 1440]) {
			await bob.setViewportSize({ width, height: 900 });
			const panel = bob.getByRole('region', { name: 'Session timer' });
			await expect(panel).toBeInViewport();
			const bounds = await panel.boundingBox();
			expect(bounds!.x).toBeGreaterThanOrEqual(0);
			expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width);
			await bob.screenshot({
				path: testInfo.outputPath(`timer-expired-${width}.png`),
				animations: 'disabled'
			});
		}
		await bob.getByRole('button', { name: 'Switch to dark mode' }).click();
		await bob.screenshot({
			path: testInfo.outputPath('timer-expired-dark.png'),
			animations: 'disabled'
		});
		await alice.getByRole('button', { name: 'Stop timer' }).focus();
		await alice.keyboard.press('Enter');
		await expect(bob.getByRole('region', { name: 'Session timer' })).toHaveCount(0);
		expect(errors).toEqual([]);
	} finally {
		await close();
	}
});

for (const width of [320, 768, 1440]) {
	test(`starting and stopping the timer keeps the table in place at ${width}px`, async ({
		page,
		request
	}, testInfo) => {
		await page.setViewportSize({ width, height: 900 });
		const roomId = await createRoom(request);
		await joinRoom(page, roomId, 'Alice');
		const table = page.locator('main > div').nth(1);
		const before = await table.boundingBox();
		await page.getByRole('button', { name: 'Timer', exact: true }).click();
		await page.getByRole('menuitem', { name: '1 min', exact: true }).click();
		const panel = page.getByRole('region', { name: 'Session timer' });
		await expect(panel).toBeVisible();
		await expect.soft(panel.getByRole('button', { name: 'Add 30 seconds' })).toHaveCount(0);
		await expect.soft(panel.getByRole('button', { name: 'Remove 30 seconds' })).toHaveCount(0);
		const ring = await panel.locator('svg').nth(0).boundingBox();
		const icon = await panel.locator('svg').nth(1).boundingBox();
		expect.soft(icon!.x + icon!.width / 2).toBeCloseTo(ring!.x + ring!.width / 2, 1);
		expect.soft(icon!.y + icon!.height / 2).toBeCloseTo(ring!.y + ring!.height / 2, 1);
		const during = await table.boundingBox();
		expect(during!.y).toBe(before!.y);
		expect(during!.x).toBe(before!.x);
		await expect(page.getByText('Everyone sees the same countdown.')).toHaveCount(0);
		const bounds = await panel.boundingBox();
		expect(bounds!.width).toBeLessThanOrEqual(260);
		expect(bounds!.height).toBeLessThanOrEqual(120);
		if (width < 640) {
			const card = await seatOf(page, 'Alice').locator('.flip-scene').boundingBox();
			expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(card!.y);
		}
		await page.screenshot({
			path: testInfo.outputPath('compact-timer.png'),
			animations: 'disabled'
		});
		await page.getByRole('button', { name: 'Stop timer' }).click();
		await expect(panel).toHaveCount(0);
		expect(await table.boundingBox()).toEqual(before);
	});
}

for (const reducedMotion of ['no-preference', 'reduce'] as const) {
	test(`the completion icon shakes three times with motion preference ${reducedMotion}`, async ({
		page,
		request
	}) => {
		await page.emulateMedia({ reducedMotion });
		const roomId = await createRoom(request);
		await joinRoom(page, roomId, 'Alice');
		await page.getByRole('button', { name: 'Timer', exact: true }).click();
		await page.getByRole('menuitem', { name: '1 min', exact: true }).click();
		await expect(page.getByRole('timer', { name: 'Time remaining' })).toBeVisible();
		const bell = page.locator('[data-timer-bell]');
		const shaking =
			reducedMotion === 'no-preference'
				? page.waitForFunction(() =>
						document
							.querySelector('[data-timer-bell]')
							?.getAnimations()
							.some((animation) => animation.playState === 'running')
					)
				: null;
		await page.clock.setFixedTime(new Date(Date.now() + 61_000));
		await expect(page.getByRole('status')).toHaveText("Time's up");
		if (shaking) {
			await shaking;
			const timing = await bell.evaluate((element) =>
				element.getAnimations()[0].effect!.getTiming()
			);
			expect(timing.duration).toBe(480);
			expect(timing.iterations).toBe(3);
			await bell.evaluate(async (element) =>
				Promise.all(element.getAnimations().map((animation) => animation.finished))
			);
		}
		expect(await bell.evaluate((element) => element.getAnimations().length)).toBe(0);
		await page.reload();
		await expect(page.getByRole('status')).toHaveText("Time's up");
		expect(await bell.evaluate((element) => element.getAnimations().length)).toBe(0);
	});
}

test('timer adjustments preserve the countdown pace', async ({ page, request }) => {
	const roomId = await createRoom(request, { moderated: true });
	let endsAt = 0;
	page.on('websocket', (socket) => {
		socket.on('framereceived', ({ payload }) => {
			const message = JSON.parse(payload.toString()) as ServerMessage;
			if (message.type === 'state' && message.state.timer) endsAt = message.state.timer.endsAt;
		});
	});
	await joinRoom(page, roomId, 'Alice');
	await page.getByRole('button', { name: 'Timer', exact: true }).click();
	await page.getByRole('menuitem', { name: '1 min', exact: true }).click();
	const timer = page.getByRole('timer', { name: 'Time remaining' });
	await expect(timer).toBeVisible();
	let browserNow = endsAt - 40_000;
	await page.clock.setFixedTime(new Date(browserNow));
	await expect(timer).toHaveText('0:40');
	const ring = page.getByRole('region', { name: 'Session timer' }).locator('circle[pathLength]');
	expect(Number(await ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(100 / 3);

	const originalDeadline = endsAt;
	await page.getByRole('button', { name: 'Add 30 seconds' }).click();
	await expect(timer).toHaveText('1:10');
	await expect(ring).toHaveAttribute('stroke-dashoffset', '0');
	expect(endsAt).toBe(originalDeadline + 30_000);
	await page.reload();
	await expect(timer).toHaveText('1:10');
	await expect(ring).toHaveAttribute('stroke-dashoffset', '0');
	for (const expected of ['1:09', '1:08', '1:07', '1:06', '1:05']) {
		browserNow += 1000;
		await page.clock.setFixedTime(new Date(browserNow));
		await expect(timer).toHaveText(expected);
	}
	await page.getByRole('button', { name: 'Remove 30 seconds' }).click();
	await expect(timer).toHaveText('0:35');
	expect(Number(await ring.getAttribute('stroke-dashoffset'))).toBeCloseTo(100 * (1 - 35 / 60));
	expect(endsAt).toBe(originalDeadline);
	for (const expected of ['0:34', '0:33', '0:32', '0:31', '0:30']) {
		browserNow += 1000;
		await page.clock.setFixedTime(new Date(browserNow));
		await expect(timer).toHaveText(expected);
	}
});

test('the timer never covers players in a short six-player room', async ({
	browser,
	request
}, testInfo) => {
	const roomId = await createRoom(request, { moderated: true });
	const contexts = [];
	const pages: Page[] = [];
	try {
		for (const name of ['Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank']) {
			const context = await browser.newContext();
			contexts.push(context);
			const page = await context.newPage();
			pages.push(page);
			await joinRoom(page, roomId, name);
		}
		const host = pages[0];
		for (const viewport of [
			{ width: 640, height: 480 },
			{ width: 1024, height: 600 }
		]) {
			await host.setViewportSize(viewport);
			const table = host.locator('main > div').nth(1);
			const before = await table.boundingBox();
			await host.getByRole('button', { name: 'Timer', exact: true }).click();
			await host.getByRole('menuitem', { name: '1 min', exact: true }).click();
			const panel = host.getByRole('region', { name: 'Session timer' });
			await expect(panel).toBeVisible();
			const bounds = await panel.boundingBox();
			for (const name of ['Alice', 'Carol', 'Erin']) {
				const card = await seatOf(host, name).locator('.flip-scene').boundingBox();
				expect(card!.y).toBeGreaterThanOrEqual(bounds!.y + bounds!.height);
			}
			expect(await table.boundingBox()).toEqual(before);
			await host.screenshot({
				path: testInfo.outputPath(`six-players-${viewport.width}.png`),
				animations: 'disabled'
			});
			await host.getByRole('button', { name: 'Stop timer' }).click();
			await expect(panel).toHaveCount(0);
			expect(await table.boundingBox()).toEqual(before);
		}
	} finally {
		await Promise.all(contexts.map((context) => context.close()));
	}
});
