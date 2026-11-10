/**
 * Viewer settings for the live map, kept in this browser's localStorage.
 * Storage can be unavailable (private mode, blocked site data), so every access is guarded and
 * the defaults apply when it fails.
 */
import { writable } from 'svelte/store';

export type Units = 'imperial' | 'metric';

const UNITS_KEY = 'xcnav.live.units';

function defaultUnits(): Units {
	if (typeof navigator === 'undefined') return 'metric';
	const region = (navigator.language || '').split('-')[1]?.toUpperCase();
	return region === 'US' || region === 'LR' || region === 'MM' ? 'imperial' : 'metric';
}

function loadUnits(): Units {
	try {
		const v = localStorage.getItem(UNITS_KEY);
		if (v === 'imperial' || v === 'metric') return v;
	} catch {
		// Storage unavailable; use the default.
	}
	return defaultUnits();
}

export const units = writable<Units>(typeof window === 'undefined' ? 'metric' : loadUnits());

// Save only changes the viewer makes, so an untouched default keeps following the locale.
let initial = true;
units.subscribe((v) => {
	if (initial) {
		initial = false;
		return;
	}
	if (typeof window === 'undefined') return;
	try {
		localStorage.setItem(UNITS_KEY, v);
	} catch {
		// Storage unavailable; the setting lasts until the page closes.
	}
});
