import { error } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ params, platform }) => {
	if (!platform || !/^[A-Za-z0-9_-]{4,32}$/.test(params.id)) error(404, 'Room not found');

	const stub = platform.env.POKER_ROOM.get(platform.env.POKER_ROOM.idFromName(params.id));
	const info = await stub.roomInfo();
	if (!info) error(404, 'Room not found');

	return { roomId: params.id, roomName: info.roomName };
};
