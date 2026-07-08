// Minimal worker entry for tests (see wrangler.test.jsonc).
export { PokerRoom } from '../src/lib/server/poker-room';

export default {
	fetch() {
		return new Response('test worker');
	}
};
