/**
 * Ground elevation lookups from MapTiler's terrain-rgb-v2 tiles, the same tileset the 3D map uses.
 *
 * MapTiler has no point-elevation REST endpoint; its own client SDK reads elevation by decoding
 * these tiles, and so does this module. Unlike MapLibre's queryTerrainElevation, this works for
 * pilots outside the current view and does not depend on the map's zoom level.
 *
 * Browser only: it decodes tiles with a canvas. Calls made during SSR return null.
 */
import { MAPTILER_KEY } from './config';

/**
 * Tile zoom used for lookups. A 512 px tile at z12 is about 19 m per pixel at the equator, finer
 * than the 30 m source data, and covers about 10 km, so a group of pilots shares a few tiles.
 */
const ZOOM = 12;
const TILE_SIZE = 512;
/** Decoded tiles kept in memory. Each one is 1 MB. */
const MAX_TILES = 16;
/** Wait this long before fetching a tile again after it failed. */
const RETRY_MS = 60_000;

interface CacheEntry {
	tile: Promise<Float32Array | null>;
	failedAt?: number;
}

const cache = new Map<string, CacheEntry>();

function tileUrl(x: number, y: number): string {
	return `https://api.maptiler.com/tiles/terrain-rgb-v2/${ZOOM}/${x}/${y}.webp?key=${MAPTILER_KEY}`;
}

async function loadTile(x: number, y: number): Promise<Float32Array | null> {
	const res = await fetch(tileUrl(x, y));
	if (!res.ok) throw new Error(`terrain tile ${x}/${y}: HTTP ${res.status}`);
	const bitmap = await createImageBitmap(await res.blob());
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) throw new Error('2D canvas unavailable');
	ctx.drawImage(bitmap, 0, 0);
	bitmap.close();
	const { data } = ctx.getImageData(0, 0, canvas.width, canvas.height);
	const out = new Float32Array(canvas.width * canvas.height);
	for (let i = 0; i < out.length; i++) {
		const o = i * 4;
		// MapTiler terrain-rgb encoding, in meters.
		out[i] = -10000 + (data[o] * 65536 + data[o + 1] * 256 + data[o + 2]) * 0.1;
	}
	return out;
}

function getTile(x: number, y: number): Promise<Float32Array | null> {
	const key = `${x}/${y}`;
	const hit = cache.get(key);
	if (hit && (hit.failedAt === undefined || Date.now() - hit.failedAt < RETRY_MS)) {
		// Re-insert to mark it as most recently used.
		cache.delete(key);
		cache.set(key, hit);
		return hit.tile;
	}
	const entry: CacheEntry = { tile: Promise.resolve(null) };
	entry.tile = loadTile(x, y).catch((e) => {
		console.warn(e);
		entry.failedAt = Date.now();
		return null;
	});
	cache.delete(key);
	cache.set(key, entry);
	while (cache.size > MAX_TILES) cache.delete(cache.keys().next().value as string);
	return entry.tile;
}

/** Ground elevation in meters above mean sea level, or null when it is not available. */
export async function groundElevation(lng: number, lat: number): Promise<number | null> {
	if (typeof document === 'undefined') return null;
	if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lat) > 85.05) return null;
	const n = 2 ** ZOOM;
	const wrapped = ((((lng + 180) % 360) + 360) % 360) / 360;
	const sin = Math.sin((lat * Math.PI) / 180);
	const fy = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * n;
	const fx = wrapped * n;
	const tx = Math.min(n - 1, Math.floor(fx));
	const ty = Math.min(n - 1, Math.floor(fy));

	const tile = await getTile(tx, ty);
	if (!tile) return null;
	const size = Math.round(Math.sqrt(tile.length)) || TILE_SIZE;
	const px = Math.min(size - 1, Math.floor((fx - tx) * size));
	const py = Math.min(size - 1, Math.floor((fy - ty) * size));
	const e = tile[py * size + px];
	return Number.isFinite(e) ? e : null;
}
