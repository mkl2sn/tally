import type { PokerRoom } from '../src/lib/server/poker-room';

declare module 'cloudflare:test' {
	interface ProvidedEnv {
		POKER_ROOM: DurableObjectNamespace<PokerRoom>;
	}
}
