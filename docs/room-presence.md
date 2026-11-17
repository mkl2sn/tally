# Room disconnect presence

Closing a browser tab marks its player offline and immediately shows a WifiOff
icon left of the name and an Offline label. Only the card is dimmed; the name and status remain
readable. Status sits above the name for seats above the table and below the
name for seats below it. Labels face away from the table, keeping neighboring
cards aligned. The status tooltip explains the 30-second
grace period and is available on hover and keyboard focus. It remains visible
alongside highest/lowest labels after reveal.
The seat disappears after the existing 30-second offline grace period, without
another participant voting or changing room settings. This is a presence timeout,
not a moderator ban: reconnecting can restore the saved identity and vote.

## Cause and fix

The disconnect broadcast counted every socket returned by `getWebSockets()` as
online, including sockets in the closing state. That snapshot kept the player
online until a later room action produced a fresh snapshot. When `lastSeen` was
left at zero, the later snapshot could also hide the seat immediately instead of
showing the grace period.

The server now completes the close handshake before computing presence, and only
counts sockets whose `readyState` is `OPEN`. Broadcasts also skip closing sockets.
Other open sockets for the same player still keep that player online.

Cloudflare documents that `getWebSockets()` can include closing connections:
[Durable Object State, getWebSockets](https://developers.cloudflare.com/durable-objects/api/state/#getwebsockets).

Abrupt network loss still uses the existing heartbeat timeout. Unlike a normal
tab close, a missing close frame cannot signal an immediate disconnect.

## Retention and cleanup

The server retains a disconnected player's identity and current vote for 24 hours.
Reconnecting within that period restores the saved identity, vote, and moderator
role if nobody else has claimed it. After 24 hours offline, an alarm removes the
stored player and current vote, including offline moderators. Cleanup clears a
removed moderator's assignment so another participant can claim it. Round history
remains intact. Expired players can join again; cleanup does not ban them.

A shared alarm scheduler selects the earliest deadline among player cleanup,
reveal countdowns, and room expiry. Room activity cannot postpone player cleanup.
Cleanup does not refresh room activity or require another player to join.

## Verification

The Playwright regression closes Bob's tab and leaves Alice's tab untouched.
It asserts that Bob's status appears, only the card dims, and the tooltip opens
on keyboard focus. It captures the offline state and waits for the seat to disappear after the grace period. The offline assertion
failed against the original implementation and passed after the fix.

Run the regression against the built Worker:

```sh
pnpm build
pnpm exec playwright test -g 'closing a tab'
```

Worker tests cover automatic cleanup in open and moderated rooms, persisted vote
removal, moderator reassignment, reconnecting with a saved vote, and cleanup
scheduling across room activity and reveal countdowns. Browser checks also cover
offline outliers at 320px, 768px, and 1440px in both themes with reduced motion.
