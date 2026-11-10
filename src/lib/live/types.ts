/** Shapes returned by static/api/group.php. */

/** [lng, lat, altitude meters MSL, server receive time seconds] */
export type TrackPoint = [number, number, number, number];

export interface Pilot {
	id: string;
	name: string;
	connected: boolean;
	/** Seconds since the reflector received this position. */
	age: number;
	lat: number;
	lng: number;
	/** Meters MSL. */
	alt: number;
	/** Avatar hash, or null when no avatar is available. */
	avatar: string | null;
	/** Track points added since the `since` cursor in the request. */
	track: TrackPoint[];
}

export interface Waypoint {
	id: string;
	name: string;
	icon: string | null;
	color: string;
	opacity: number;
	/** [lng, lat] points. One point is a marker; more is a path. */
	points: [number, number][];
}

export interface GroupSnapshot {
	group: string;
	serverTime: number;
	cursor: number;
	/** True when the reflector is restarting or unreachable and this is the last known data. */
	degraded: boolean;
	/** Seconds to wait before polling again. Older servers leave it out. */
	next?: number;
	pilots: Pilot[];
	waypoints: Waypoint[];
}

export type FetchResult =
	| { ok: true; data: GroupSnapshot }
	| {
			ok: false;
			kind: 'invalid' | 'not_found' | 'unavailable';
			/** Seconds from the Retry-After header, when the server sent one. */
			retryAfter?: number;
	  };

export const GROUP_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
