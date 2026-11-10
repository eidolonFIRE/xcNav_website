import { base } from '$app/paths';
import type { FetchResult, GroupSnapshot } from './types';

export async function fetchGroup(groupId: string, since: number): Promise<FetchResult> {
	const params = new URLSearchParams({ g: groupId });
	if (since > 0) params.set('since', since.toFixed(3));
	let res: Response;
	try {
		res = await fetch(`${base}/api/group.php?${params}`, { cache: 'no-store' });
	} catch {
		return { ok: false, kind: 'unavailable' };
	}
	if (res.status === 400) return { ok: false, kind: 'invalid' };
	if (res.status === 404) return { ok: false, kind: 'not_found' };
	if (!res.ok) {
		const retryAfter = Number(res.headers.get('Retry-After'));
		return {
			ok: false,
			kind: 'unavailable',
			retryAfter: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined
		};
	}
	try {
		return { ok: true, data: (await res.json()) as GroupSnapshot };
	} catch {
		return { ok: false, kind: 'unavailable' };
	}
}

export function avatarUrl(groupId: string, pilotId: string, hash: string): string {
	const params = new URLSearchParams({ g: groupId, p: pilotId, h: hash });
	return `${base}/api/avatar.php?${params}`;
}
