/**
 * 3D spectator map: MapLibre with MapTiler terrain for the base map, deck.gl for pilots and
 * flight paths drawn at their real altitude.
 *
 * deck.gl runs on its own canvas over the map, and its camera follows MapLibre's through public
 * MapLibre calls only. @deck.gl/mapbox's MapboxOverlay is not used: it reads `map.transform`,
 * which MapLibre 6 removed, so with terrain on its camera stopped following the map.
 *
 * Load this module with a dynamic import. It touches `window` and WebGL.
 */
import {
	LngLatBounds,
	Map as MapLibreMap,
	NavigationControl,
	ScaleControl,
	setWorkerUrl,
	type GeoJSONSource,
	type PaddingOptions,
	type LngLatLike
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 loads its worker from a file next to its own module. Bundling breaks that, so emit
// the worker as an asset and point MapLibre at it.
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { IconLayer, LineLayer, PathLayer, TextLayer } from '@deck.gl/layers';
import { Deck, MapView, WebMercatorViewport, type Color, type MapViewState } from '@deck.gl/core';

import { MAPTILER_KEY } from './config';
import { avatarUrl } from './api';
import { pilotBadge } from './avatars';
import { drawPin, pinImageId } from './waypointIcons';
import type { GroupSnapshot, Pilot, TrackPoint, Waypoint } from './types';

setWorkerUrl(maplibreWorkerUrl);

export type BaseLayer = 'outdoor' | 'satellite';

const STYLE_URLS: Record<BaseLayer, string> = {
	outdoor: `https://api.maptiler.com/maps/outdoor-v2/style.json?key=${MAPTILER_KEY}`,
	satellite: `https://api.maptiler.com/maps/hybrid/style.json?key=${MAPTILER_KEY}`
};
const TERRAIN_URL = `https://api.maptiler.com/tiles/terrain-rgb-v2/tiles.json?key=${MAPTILER_KEY}`;

/** Seconds without a new fix before a pilot is drawn faded. */
export const STALE_AFTER = 60;
/** Click distance in pixels from a pilot icon's center (icons are 40 px). */
const PILOT_HIT_RADIUS = 24;
/** Break a flight path where fixes are further apart than this, in seconds. */
const TRACK_GAP = 300;

const PALETTE: [number, number, number][] = [
	[255, 87, 34],
	[33, 150, 243],
	[76, 175, 80],
	[233, 30, 99],
	[255, 193, 7],
	[156, 39, 176],
	[0, 188, 212],
	[205, 220, 57]
];

export function pilotColor(id: string): [number, number, number] {
	let h = 0;
	for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
	return PALETTE[h % PALETTE.length];
}

export function rgbCss([r, g, b]: [number, number, number]): string {
	return `rgb(${r}, ${g}, ${b})`;
}

interface Segment {
	pilotId: string;
	color: Color;
	path: [number, number, number][];
}

export class LiveMap {
	readonly map: MapLibreMap;
	private deck: Deck<MapView>;
	private groupId: string;
	private pilots: Pilot[] = [];
	private waypoints: Waypoint[] = [];
	private tracks = new Map<string, TrackPoint[]>();
	private framed = false;
	private iconVersion = 0;
	private lastGroundKey = '';
	private onPilotClick: (id: string) => void;
	private scale: ScaleControl;

	constructor(container: HTMLElement, groupId: string, onPilotClick: (id: string) => void) {
		this.groupId = groupId;
		this.onPilotClick = onPilotClick;
		this.map = new MapLibreMap({
			container,
			style: STYLE_URLS.outdoor,
			center: [-98, 39],
			zoom: 3,
			maxPitch: 85,
			attributionControl: { compact: true }
		});
		this.map.addControl(
			new NavigationControl({ visualizePitch: true }),
			'bottom-right'
		);
		this.scale = new ScaleControl({ unit: 'metric' });
		this.map.addControl(this.scale, 'bottom-left');

		// deck.gl gets its own canvas above the map and below the map controls. Sharing MapLibre's
		// WebGL context disturbed the terrain lookup MapLibre uses to anchor pan and wheel zoom
		// under the cursor, which made both overshoot.
		const deckHost = document.createElement('div');
		Object.assign(deckHost.style, { position: 'absolute', inset: '0', pointerEvents: 'none' });
		container.appendChild(deckHost);
		this.deck = new Deck<MapView>({
			parent: deckHost,
			width: '100%',
			height: '100%',
			views: new MapView({ repeat: true }),
			viewState: this.viewState(),
			controller: false,
			layers: []
		});
		// Follow the map camera on every map frame, so both canvases show the same frame.
		this.map.on('render', () => {
			this.deck.setProps({ viewState: this.viewState() });
			this.deck.redraw();
		});

		// Pilot clicks are hit-tested on the CPU. deck.gl picking would render a picking pass
		// and read pixels back from the GPU on every mouse move.
		this.map.on('click', (e) => {
			const id = this.pilotAt(e.point.x, e.point.y);
			if (id) this.onPilotClick(id);
		});
		this.map.on('mousemove', (e) => {
			if (!this.pilots.length) return;
			this.map.getCanvas().style.cursor = this.pilotAt(e.point.x, e.point.y) ? 'pointer' : '';
		});

		// Waypoint pins are drawn when the map first asks for each icon and color.
		this.map.on('styleimagemissing', (e) => {
			if (this.map.hasImage(e.id)) return;
			const pin = drawPin(e.id);
			if (pin) this.map.addImage(e.id, pin.image, { pixelRatio: pin.pixelRatio });
		});
		this.map.on('style.load', () => {
			this.setupStyle();
			this.render();
		});
		// Ground elevation for the drop lines is only known once terrain tiles load.
		// Redraw only when it changed, so idle frames stay idle.
		this.map.on('idle', () => {
			if (this.groundKey() !== this.lastGroundKey) this.renderDeck();
		});
	}

	destroy(): void {
		this.deck.finalize();
		this.map.remove();
	}

	setUnits(units: 'imperial' | 'metric'): void {
		this.scale.setUnit(units);
	}

	setBaseLayer(layer: BaseLayer): void {
		this.map.setStyle(STYLE_URLS[layer], { diff: false });
	}

	/** Merge a new snapshot. Track points are appended; pilots and waypoints are replaced. */
	update(snap: GroupSnapshot): void {
		this.pilots = snap.pilots;
		this.waypoints = snap.waypoints;
		const live = new Set<string>();
		for (const p of snap.pilots) {
			live.add(p.id);
			const existing = this.tracks.get(p.id) ?? [];
			const lastT = existing.length ? existing[existing.length - 1][3] : -Infinity;
			for (const pt of p.track) {
				if (pt[3] > lastT) existing.push(pt);
			}
			this.tracks.set(p.id, existing);
		}
		for (const id of this.tracks.keys()) if (!live.has(id)) this.tracks.delete(id);

		this.render();
		if (!this.framed) this.frameAll(false);
	}

	/** Fit the camera to all pilots, or to the waypoints when nobody is flying. */
	frameAll(animate = true): void {
		const coords: [number, number][] = this.pilots.length
			? this.pilots.map((p) => [p.lng, p.lat])
			: this.waypoints.flatMap((w) => w.points);
		if (!coords.length) return;
		this.framed = true;
		const bounds = coords.reduce(
			(b, c) => b.extend(c),
			new LngLatBounds(coords[0], coords[0])
		);
		this.map.fitBounds(bounds, {
			padding: { top: 120, bottom: 80, left: 80, right: 80 },
			maxZoom: 13,
			pitch: 60,
			duration: animate ? 1500 : 0
		});
	}

	flyToPilot(id: string): void {
		const p = this.pilots.find((x) => x.id === id);
		if (!p) return;
		this.map.flyTo({
			center: [p.lng, p.lat],
			zoom: Math.max(this.map.getZoom(), 13),
			pitch: 60,
			duration: 1500
		});
	}

	/**
	 * deck.gl camera matching MapLibre's. With terrain, MapLibre's camera looks at the ground under
	 * the center, so deck.gl's camera is raised by that ground elevation.
	 */
	private viewState(): MapViewState & { padding: PaddingOptions } {
		const map = this.map;
		const { lng, lat } = map.getCenter();
		const elevation = map.getTerrain() ? map.getCenterElevation() : 0;
		return {
			// getCenter can return a longitude outside [-180, 180] near the antimeridian.
			longitude: ((lng + 540) % 360) - 180,
			latitude: lat,
			zoom: map.getZoom(),
			pitch: map.getPitch(),
			bearing: map.getBearing(),
			padding: map.getPadding(),
			position: [0, 0, Number.isFinite(elevation) ? elevation : 0]
		};
	}

	/** Id of the pilot icon at a screen point, if any. */
	private pilotAt(x: number, y: number): string | null {
		if (!this.pilots.length) return null;
		const canvas = this.map.getCanvas();
		const viewport = new WebMercatorViewport({
			width: canvas.clientWidth,
			height: canvas.clientHeight,
			...this.viewState()
		});
		let best: string | null = null;
		let bestDist = PILOT_HIT_RADIUS;
		for (const p of this.pilots) {
			const [px, py] = viewport.project([p.lng, p.lat, p.alt]);
			const d = Math.hypot(px - x, py - y);
			if (d <= bestDist) {
				bestDist = d;
				best = p.id;
			}
		}
		return best;
	}

	// -- base map --------------------------------------------------------------------------

	private setupStyle(): void {
		const map = this.map;
		if (!map.getSource('xc-terrain')) {
			map.addSource('xc-terrain', { type: 'raster-dem', url: TERRAIN_URL, tileSize: 256 });
		}
		// Exaggeration must stay 1 so deck.gl altitudes (meters MSL) line up with the ground.
		map.setTerrain({ source: 'xc-terrain', exaggeration: 1 });
		map.setSky({
			'sky-color': '#7fb5ea',
			'horizon-color': '#dbe9f6',
			'fog-color': '#dbe9f6',
			'sky-horizon-blend': 0.6,
			'horizon-fog-blend': 0.7,
			'fog-ground-blend': 0.85,
			'atmosphere-blend': 0.6
		});

		if (map.getSource('xc-shadows')) return;
		const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
		map.addSource('xc-shadows', { type: 'geojson', data: empty });
		map.addSource('xc-waypoints', { type: 'geojson', data: empty });

		// Track shadows are draped on the terrain to show where each pilot flew over the ground.
		map.addLayer({
			id: 'xc-shadows',
			type: 'line',
			source: 'xc-shadows',
			layout: { 'line-join': 'round', 'line-cap': 'round' },
			paint: { 'line-color': '#000000', 'line-opacity': 0.3, 'line-width': 2 }
		});
		map.addLayer({
			id: 'xc-wp-lines',
			type: 'line',
			source: 'xc-waypoints',
			filter: ['==', ['geometry-type'], 'LineString'],
			layout: { 'line-join': 'round', 'line-cap': 'round' },
			paint: {
				'line-color': ['get', 'color'],
				'line-opacity': ['get', 'opacity'],
				'line-width': 4
			}
		});
		// Pin and name in one symbol layer, so a crowded name hides but its pin stays.
		map.addLayer({
			id: 'xc-wp-points',
			type: 'symbol',
			source: 'xc-waypoints',
			filter: ['==', ['geometry-type'], 'Point'],
			layout: {
				'icon-image': ['get', 'pin'],
				'icon-anchor': 'bottom',
				'icon-allow-overlap': true,
				'icon-ignore-placement': true,
				'text-field': ['get', 'name'],
				'text-font': ['Noto Sans Regular'],
				'text-size': 13,
				'text-offset': [0, 0.3],
				'text-anchor': 'top',
				'text-optional': true
			},
			paint: {
				'text-color': '#1b1b1b',
				'text-halo-color': '#ffffff',
				'text-halo-width': 1.5
			}
		});
	}

	// -- rendering -------------------------------------------------------------------------

	private render(): void {
		this.renderGeoJson();
		this.renderDeck();
	}

	private segments(): Segment[] {
		const out: Segment[] = [];
		for (const [pilotId, points] of this.tracks) {
			const color: Color = [...pilotColor(pilotId), 230];
			let path: [number, number, number][] = [];
			let lastT = -Infinity;
			for (const [lng, lat, alt, t] of points) {
				if (t - lastT > TRACK_GAP && path.length) {
					if (path.length > 1) out.push({ pilotId, color, path });
					path = [];
				}
				path.push([lng, lat, alt]);
				lastT = t;
			}
			// Join the path to the pilot's current position.
			const p = this.pilots.find((x) => x.id === pilotId);
			if (p) {
				const last = path[path.length - 1];
				if (!last || last[0] !== p.lng || last[1] !== p.lat || last[2] !== p.alt) {
					path.push([p.lng, p.lat, p.alt]);
				}
			}
			if (path.length > 1) out.push({ pilotId, color, path });
		}
		return out;
	}

	private renderGeoJson(): void {
		const shadows = this.map.getSource('xc-shadows') as GeoJSONSource | undefined;
		const wps = this.map.getSource('xc-waypoints') as GeoJSONSource | undefined;
		if (!shadows || !wps) return;

		shadows.setData({
			type: 'FeatureCollection',
			features: this.segments().map((s) => ({
				type: 'Feature',
				properties: {},
				geometry: { type: 'LineString', coordinates: s.path.map(([lng, lat]) => [lng, lat]) }
			}))
		});
		wps.setData({
			type: 'FeatureCollection',
			features: this.waypoints.map((w) => ({
				type: 'Feature',
				properties: {
					name: w.name,
					color: w.color,
					opacity: w.opacity,
					pin: pinImageId(w.icon, w.color)
				},
				geometry:
					w.points.length === 1
						? { type: 'Point', coordinates: w.points[0] }
						: { type: 'LineString', coordinates: w.points }
			}))
		});
	}

	private groundElevation(p: Pilot): number | null {
		try {
			const e = this.map.queryTerrainElevation([p.lng, p.lat] as LngLatLike);
			return typeof e === 'number' && Number.isFinite(e) ? e : null;
		} catch {
			return null;
		}
	}

	private groundKey(): string {
		return this.pilots.map((p) => Math.round(this.groundElevation(p) ?? -1e6)).join(',');
	}

	private renderDeck(): void {
		const pilots = this.pilots;
		this.lastGroundKey = this.groundKey();
		const alpha = (p: Pilot) => (!p.connected ? 110 : p.age > STALE_AFTER ? 160 : 255);
		const drops = pilots
			.map((p) => ({ p, ground: this.groundElevation(p) }))
			.filter((d): d is { p: Pilot; ground: number } => d.ground !== null && d.ground < d.p.alt);
		const redraw = () => {
			this.iconVersion++;
			this.renderDeck();
		};
		// Icons and labels are never hidden behind flight paths.
		const onTop = { depthCompare: 'always' as const, depthWriteEnabled: false };

		this.deck.setProps({
			layers: [
				new PathLayer<Segment>({
					id: 'xc-tracks',
					data: this.segments(),
					getPath: (d) => d.path,
					getColor: (d) => d.color,
					getWidth: 3,
					widthUnits: 'pixels',
					billboard: true,
					jointRounded: true,
					capRounded: true
				}),
				new LineLayer<{ p: Pilot; ground: number }>({
					id: 'xc-drops',
					data: drops,
					getSourcePosition: (d) => [d.p.lng, d.p.lat, d.p.alt],
					getTargetPosition: (d) => [d.p.lng, d.p.lat, d.ground],
					getColor: (d) => [...pilotColor(d.p.id), 160],
					getWidth: 1.5
				}),
				new IconLayer<Pilot>({
					id: 'xc-pilots',
					data: pilots,
					getPosition: (p) => [p.lng, p.lat, p.alt],
					getIcon: (p) => {
						const url = p.avatar ? avatarUrl(this.groupId, p.id, p.avatar) : null;
						const badge = pilotBadge(
							`${p.id}|${p.avatar ?? ''}`,
							rgbCss(pilotColor(p.id)),
							p.name,
							url,
							redraw
						);
						return { id: badge.id, url: badge.url, width: 96, height: 96, mask: false };
					},
					getSize: 40,
					sizeUnits: 'pixels',
					getColor: (p) => [255, 255, 255, alpha(p)],
					parameters: onTop,
					updateTriggers: {
						getIcon: this.iconVersion,
						getColor: pilots.map(alpha).join(',')
					}
				}),
				new TextLayer<Pilot>({
					id: 'xc-labels',
					data: pilots,
					getPosition: (p) => [p.lng, p.lat, p.alt],
					getText: (p) => p.name,
					getPixelOffset: [0, 26],
					getSize: 13,
					getColor: (p) => [255, 255, 255, alpha(p)],
					getTextAnchor: 'middle',
					getAlignmentBaseline: 'top',
					fontFamily: 'system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
					fontWeight: 600,
					characterSet: 'auto',
					background: true,
					getBackgroundColor: [20, 22, 26, 190],
					backgroundPadding: [6, 3],
					parameters: onTop,
					updateTriggers: { getColor: pilots.map(alpha).join(',') }
				})
			]
		});
	}
}
