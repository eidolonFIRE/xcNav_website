/**
 * Round pilot badges drawn to a canvas: the avatar image (or initials) inside a colored ring.
 * Returned as data URLs so deck.gl's IconLayer can pack them.
 */

const SIZE = 96;
const RING = 7;

const cache = new Map<string, string>();
const pending = new Set<string>();

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean);
	if (parts.length === 0) return '?';
	if (parts.length === 1) return Array.from(parts[0]).slice(0, 2).join('').toUpperCase();
	return (Array.from(parts[0])[0] + Array.from(parts[parts.length - 1])[0]).toUpperCase();
}

function draw(color: string, name: string, img?: HTMLImageElement): string {
	const canvas = document.createElement('canvas');
	canvas.width = canvas.height = SIZE;
	const ctx = canvas.getContext('2d');
	if (!ctx) return '';
	const r = SIZE / 2;

	ctx.beginPath();
	ctx.arc(r, r, r, 0, Math.PI * 2);
	ctx.fillStyle = color;
	ctx.fill();

	ctx.save();
	ctx.beginPath();
	ctx.arc(r, r, r - RING, 0, Math.PI * 2);
	ctx.clip();
	if (img) {
		const s = Math.min(img.naturalWidth, img.naturalHeight);
		ctx.drawImage(
			img,
			(img.naturalWidth - s) / 2,
			(img.naturalHeight - s) / 2,
			s,
			s,
			RING,
			RING,
			SIZE - 2 * RING,
			SIZE - 2 * RING
		);
	} else {
		ctx.fillStyle = '#2b2f36';
		ctx.fillRect(0, 0, SIZE, SIZE);
		ctx.fillStyle = '#ffffff';
		ctx.font = `600 ${SIZE * 0.36}px system-ui, sans-serif`;
		ctx.textAlign = 'center';
		ctx.textBaseline = 'middle';
		ctx.fillText(initials(name), r, r + 2);
	}
	ctx.restore();
	return canvas.toDataURL('image/png');
}

/**
 * Badge for a pilot, with a unique icon id. Returns the initials badge at once and loads the avatar in the background;
 * `onReady` fires when a better image is available.
 */
export function pilotBadge(
	key: string,
	color: string,
	name: string,
	avatarUrl: string | null,
	onReady: () => void
): { id: string; url: string } {
	const full = cache.get(key);
	if (full) return { id: key, url: full };
	const fallbackKey = `initials|${color}|${name}`;
	let fallback = cache.get(fallbackKey);
	if (!fallback) {
		fallback = draw(color, name);
		cache.set(fallbackKey, fallback);
	}
	if (avatarUrl && !pending.has(key)) {
		pending.add(key);
		const img = new Image();
		img.decoding = 'async';
		img.onload = () => {
			cache.set(key, draw(color, name, img));
			onReady();
		};
		img.onerror = () => cache.set(key, fallback as string);
		img.src = avatarUrl;
	}
	return { id: fallbackKey, url: fallback };
}
