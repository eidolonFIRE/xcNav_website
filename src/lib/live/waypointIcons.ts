/**
 * Map pins for waypoints: a teardrop in the waypoint color with the waypoint's icon inside.
 * Drawn to a canvas on demand, so any icon and color pair can be shown.
 *
 * Icon names match the xcNav app. Glyphs are Material Icons (24 px grid) except the windsock and
 * camp, which come from the app's own SVGs (50 px grid).
 */

type Op = { d: string; mode: 'fill' | 'stroke' | 'cut'; width?: number };

interface Glyph {
	/** Size of the source grid. */
	grid: number;
	/** Glyph size relative to the default. */
	scale?: number;
	/** Shift applied before scaling, in grid units. */
	offset?: [number, number];
	ops: Op[];
}

function circle(cx: number, cy: number, r: number): string {
	return `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;
}

function material(d: string, scale?: number): Glyph {
	return { grid: 24, scale, ops: [{ d, mode: 'fill' }] };
}

const GLYPHS: Record<string, Glyph> = {
	'': material(circle(12, 12, 10), 0.55),
	star: material('M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z'),
	x: material(
		'M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z'
	),
	question: material(
		'M11.07 12.85c.77-1.39 2.25-2.21 3.11-3.44.91-1.29.4-3.7-2.18-3.7-1.69 0-2.52 1.28-2.87 2.34L6.54 6.96C7.25 4.83 9.18 3 11.99 3c2.35 0 3.96 1.07 4.78 2.41.7 1.15 1.11 3.3.03 4.9-1.2 1.77-2.35 2.31-2.97 3.45-.25.46-.35.76-.35 2.24h-2.89c-.01-.78-.13-2.05.48-3.15zM14 20c0 1.1-.9 2-2 2s-2-.9-2-2 .9-2 2-2 2 .9 2 2z'
	),
	exclamation: material(`${circle(12, 19, 2)}M10 3h4v12h-4z`),
	flag: material(
		'M11 6H9V4h2v2zm4-2h-2v2h2V4zM9 14h2v-2H9v2zm10-4V8h-2v2h2zm0 4v-2h-2v2h2zm-6 0h2v-2h-2v2zm6-10h-2v2h2V4zm-6 4V6h-2v2h2zm-6 2V8h2V6H7V4H5v16h2v-8h2v-2H7zm8 2h2v-2h-2v2zm-4-2v2h2v-2h-2zM9 8v2h2V8H9zm4 2h2V8h-2v2zm2-4v2h2V6h-2z'
	),
	airport: material(
		'M22 16v-2l-8.5-5V3.5c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5V9L2 14v2l8.5-2.5V19L8 20.5V22l4-1 4 1v-1.5L13.5 19v-5.5L22 16z'
	),
	windsock: {
		grid: 50,
		offset: [0, -283.77082],
		ops: [
			{ d: 'M34 329.97V291.58', mode: 'stroke', width: 4 },
			{ d: circle(33.94, 291.07, 3.5), mode: 'fill' },
			{
				d: 'm32.08 294.45-17.28 2.88-7.45 3.46 1.34 3.43 8.03-2.09 15.36 1.92z',
				mode: 'fill'
			},
			// The sock's stripes are cut out in the pin color.
			{ d: 'm11.52 298.91 1.1 4.28', mode: 'cut', width: 1.6 },
			{ d: 'm19.44 296.59.27 5.94', mode: 'cut', width: 1.6 },
			{ d: 'm28.24 295.41.17 8.35', mode: 'cut', width: 1.6 }
		]
	},
	camp: {
		grid: 50,
		offset: [0, -283.77082],
		ops: [
			{ d: 'M1.95 324.95H47.82', mode: 'stroke', width: 3.5 },
			{
				d: 'M6.37 324.13 24.89 288.64 43.4 324.13H32.29l-7.41-17.74-7.41 17.74z',
				mode: 'fill'
			},
			{ d: 'm21.18 285.63 3.7 5.46 3.7-5.46', mode: 'stroke', width: 2.5 }
		]
	},
	paraglider: material(
		'M12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm-3.48.94C8.04 17.55 7 16.76 7 14H5c0 2.7.93 4.41 2.3 5.5.5.4 1.1.7 1.7.9V24h6v-3.6c.6-.2 1.2-.5 1.7-.9 1.37-1.09 2.3-2.8 2.3-5.5h-2c0 2.76-1.04 3.55-1.52 3.94C14.68 18.54 14 19 12 19s-2.68-.46-3.48-1.06zM12 0C5.92 0 1 1.9 1 4.25v3.49c0 .81.88 1.26 1.56.83.14-.09.28-.18.44-.26L5 13h2l1.5-6.28a27.852 27.852 0 0 1 7 0L17 13h2l2-4.69c.16.09.3.17.44.26.68.43 1.56-.02 1.56-.83V4.25C23 1.9 18.08 0 12 0zM5.88 11.24 4.37 7.69c.75-.28 1.6-.52 2.53-.71l-1.02 4.26zm12.24 0L17.1 6.98c.93.19 1.78.43 2.53.71l-1.51 3.55z'
	),
	left: material('m6.83 11 1.59 1.59L7 14l-4-4 4-4 1.41 1.41L6.83 9H15c1.1 0 2 .9 2 2v9h-2v-9H6.83z'),
	right: material('m17.17 11-1.59 1.59L17 14l4-4-4-4-1.41 1.41L17.17 9H9c-1.1 0-2 .9-2 2v9h2v-9h8.17z'),
	fuel: material(
		'm19.77 7.23.01-.01-3.72-3.72L15 4.56l2.11 2.11c-.94.36-1.61 1.26-1.61 2.33a2.5 2.5 0 0 0 2.5 2.5c.36 0 .69-.08 1-.21v7.21c0 .55-.45 1-1 1s-1-.45-1-1V14c0-1.1-.9-2-2-2h-1V5c0-1.1-.9-2-2-2H6c-1.1 0-2 .9-2 2v16h10v-7.5h1.5v5a2.5 2.5 0 0 0 5 0V9c0-.69-.28-1.32-.73-1.77zM12 10H6V5h6v5zm6 0c-.55 0-1-.45-1-1s.45-1 1-1 1 .45 1 1-.45 1-1 1z'
	),
	sleep: material(
		'M7 13c1.66 0 3-1.34 3-3S8.66 7 7 7s-3 1.34-3 3 1.34 3 3 3zm12-6h-8v7H3V5H1v15h2v-3h18v3h2v-9c0-2.21-1.79-4-4-4z'
	),
	camera: material(
		`${circle(12, 12, 3.2)}M9 2 7.17 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2h-3.17L15 2H9zm3 15c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5z`
	),
	takeoff: material(
		'M2.5 19h19v2h-19v-2zm19.57-9.36c-.21-.8-1.04-1.28-1.84-1.06L14.92 10l-6.9-6.43-1.93.51 4.14 7.17-4.97 1.33-1.97-1.54-1.45.39 2.59 4.49s7.12-1.9 16.57-4.43c.81-.23 1.28-1.05 1.07-1.85z'
	),
	landing: material(
		'M2.5 19h19v2h-19v-2zm16.84-3.15c.8.21 1.62-.26 1.84-1.06.21-.8-.26-1.62-1.06-1.84l-5.31-1.42-2.76-9.02L10.12 2v8.28L5.15 8.95l-.93-2.32-1.45-.39v5.17l16.57 4.44z'
	)
};

/** Image id prefix for waypoint pins in the map style. */
const PREFIX = 'wp-pin|';

/** Device pixels per CSS pixel. Pins are drawn at 2x so they stay sharp on high-DPI screens. */
const RATIO = 2;
/** Pin head radius, CSS px. */
const HEAD_R = 13;
/** Distance from head center to tip, CSS px. */
const TIP = 30;
/** Glyph size, CSS px. */
const GLYPH = 17;
const STROKE = 2;
/** Room around the pin for the stroke and shadow, CSS px. */
const PAD = 3;

/** Style image id for a waypoint's pin. */
export function pinImageId(icon: string | null, color: string): string {
	return `${PREFIX}${icon ?? ''}|${color}`;
}

/** Dark glyphs on light pins, white glyphs on dark ones. */
function glyphColor(fill: string): string {
	const m = /^#([0-9a-f]{6})$/i.exec(fill);
	if (!m) return '#ffffff';
	const v = parseInt(m[1], 16);
	const lum = (0.299 * ((v >> 16) & 255) + 0.587 * ((v >> 8) & 255) + 0.114 * (v & 255)) / 255;
	return lum > 0.7 ? '#1b1b1b' : '#ffffff';
}

/**
 * Pixels for a pin image id made by `pinImageId`, or null when the id is not a pin.
 * The tip is at the bottom center of the image.
 */
export function drawPin(id: string): { image: ImageData; pixelRatio: number } | null {
	if (!id.startsWith(PREFIX)) return null;
	const rest = id.slice(PREFIX.length);
	const split = rest.lastIndexOf('|');
	if (split < 0) return null;
	const icon = rest.slice(0, split);
	const color = rest.slice(split + 1);
	const glyph = GLYPHS[icon] ?? GLYPHS[''];

	const w = 2 * (HEAD_R + PAD);
	// No room below the tip, so the image bottom is the point on the map.
	const h = PAD + HEAD_R + TIP;
	const canvas = document.createElement('canvas');
	canvas.width = w * RATIO;
	canvas.height = h * RATIO;
	const ctx = canvas.getContext('2d', { willReadFrequently: true });
	if (!ctx) return null;
	ctx.scale(RATIO, RATIO);

	// Teardrop: the head circle joined to the tip by its two tangent lines.
	const cx = w / 2;
	const cy = PAD + HEAD_R;
	const tipY = cy + TIP;
	const beta = Math.acos(HEAD_R / TIP);
	const pin = new Path2D();
	pin.moveTo(cx, tipY - STROKE / 2);
	pin.arc(cx, cy, HEAD_R, Math.PI / 2 + beta, Math.PI / 2 - beta + Math.PI * 2);
	pin.closePath();

	ctx.save();
	ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
	ctx.shadowBlur = 3;
	ctx.shadowOffsetY = 1;
	ctx.fillStyle = color;
	ctx.fill(pin);
	ctx.restore();
	ctx.lineWidth = STROKE;
	ctx.lineJoin = 'round';
	ctx.strokeStyle = '#ffffff';
	ctx.stroke(pin);

	const size = GLYPH * (glyph.scale ?? 1);
	const k = size / glyph.grid;
	const [ox, oy] = glyph.offset ?? [0, 0];
	const fg = glyphColor(color);
	ctx.translate(cx - size / 2, cy - size / 2);
	ctx.scale(k, k);
	ctx.translate(ox, oy);
	for (const op of glyph.ops) {
		const path = new Path2D(op.d);
		if (op.mode === 'fill') {
			ctx.fillStyle = fg;
			ctx.fill(path);
		} else {
			ctx.lineWidth = op.width ?? 1;
			ctx.lineCap = 'round';
			ctx.strokeStyle = op.mode === 'cut' ? color : fg;
			ctx.stroke(path);
		}
	}

	return { image: ctx.getImageData(0, 0, canvas.width, canvas.height), pixelRatio: RATIO };
}
