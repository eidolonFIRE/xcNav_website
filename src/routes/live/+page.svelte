<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { base } from '$app/paths';
	import { fetchGroup } from '$lib/live/api';
	import {
		JITTER_MS,
		MAX_BACKOFF_MS,
		MAX_RETRY_AFTER_MS,
		MIN_POLL_MS,
		POLL_MS
	} from '$lib/live/config';
	import { groundElevation } from '$lib/live/elevation';
	import { units } from '$lib/live/settings';
	import { GROUP_ID_RE, type Pilot } from '$lib/live/types';
	import type { BaseLayer, LiveMap } from '$lib/live/liveMap';

	type Status = 'idle' | 'loading' | 'live' | 'degraded' | 'retrying' | 'not_found';

	let input = '';
	let inputError = '';
	let groupId = '';
	let status: Status = 'idle';
	let pilots: Pilot[] = [];
	/** Ground elevation in meters MSL under each pilot, by pilot id. */
	let ground: Record<string, number> = {};
	let receivedAt = 0;
	let now = Date.now();
	let baseLayer: BaseLayer = 'outdoor';
	let listOpen = true;
	let selected = '';
	let mapError = '';
	let settingsOpen = false;
	let settingsEl: HTMLDivElement;

	let mapEl: HTMLDivElement;
	let live: LiveMap | null = null;
	let pilotColor: ((id: string) => [number, number, number]) | null = null;
	let staleAfter = 60;
	let since = 0;
	let pollTimer: ReturnType<typeof setTimeout> | undefined;
	let clock: ReturnType<typeof setInterval> | undefined;
	let session = 0;
	let inFlight = -1;
	/** Failed polls in a row, for the backoff. */
	let failures = 0;
	/** When the next poll is due, so returning to the tab does not poll early. */
	let nextDue = 0;

	onMount(() => {
		clock = setInterval(() => (now = Date.now()), 1000);
		document.addEventListener('visibilitychange', onVisibility);
		window.addEventListener('popstate', readUrl);
		readUrl();
	});

	onDestroy(() => {
		if (typeof document === 'undefined') return;
		stop();
		clearInterval(clock);
		document.removeEventListener('visibilitychange', onVisibility);
		window.removeEventListener('popstate', readUrl);
	});

	function readUrl() {
		const g = new URLSearchParams(window.location.search).get('g')?.trim().toLowerCase() ?? '';
		if (g && GROUP_ID_RE.test(g)) {
			input = g;
			if (g !== groupId) start(g, false);
		} else if (groupId) {
			stop();
		}
	}

	function submit() {
		const g = input.trim().toLowerCase();
		if (!GROUP_ID_RE.test(g)) {
			inputError = 'Enter the group code shown in the xcNav app, for example c21557.';
			return;
		}
		start(g, true);
	}

	async function start(g: string, pushUrl: boolean) {
		stop();
		inputError = '';
		mapError = '';
		groupId = g;
		status = 'loading';
		since = 0;
		failures = 0;
		nextDue = 0;
		const mySession = ++session;
		if (pushUrl) {
			const url = new URL(window.location.href);
			url.searchParams.set('g', g);
			history.pushState(null, '', url);
		}
		await tick();
		try {
			const mod = await import('$lib/live/liveMap');
			if (mySession !== session) return;
			pilotColor = mod.pilotColor;
			staleAfter = mod.STALE_AFTER;
			live = new mod.LiveMap(mapEl, g, selectPilot);
			live.setUnits($units);
			if (baseLayer !== 'outdoor') live.setBaseLayer(baseLayer);
		} catch (e) {
			console.error(e);
			mapError = 'Your browser could not start the 3D map. Make sure WebGL is turned on.';
		}
		poll(mySession);
	}

	function stop() {
		session++;
		clearTimeout(pollTimer);
		live?.destroy();
		live = null;
		groupId = '';
		pilots = [];
		ground = {};
		status = 'idle';
		selected = '';
	}

	function changeGroup() {
		stop();
		const url = new URL(window.location.href);
		url.searchParams.delete('g');
		history.pushState(null, '', url);
	}

	async function poll(mySession: number) {
		clearTimeout(pollTimer);
		if (mySession !== session) return;
		if (document.hidden) return; // resumed by onVisibility
		if (inFlight === mySession) return; // a request is already running and will reschedule
		inFlight = mySession;
		const res = await fetchGroup(groupId, since);
		if (inFlight === mySession) inFlight = -1;
		if (mySession !== session) return;

		let delay: number;
		if (res.ok) {
			failures = 0;
			delay =
				typeof res.data.next === 'number'
					? Math.min(MAX_RETRY_AFTER_MS, res.data.next * 1000)
					: POLL_MS;
			since = res.data.cursor;
			pilots = res.data.pilots;
			receivedAt = Date.now();
			status = res.data.degraded ? 'degraded' : 'live';
			live?.update(res.data);
			updateGround(mySession, res.data.pilots);
		} else if (res.kind === 'invalid') {
			const bad = groupId;
			changeGroup();
			input = bad;
			inputError = 'That group code is not valid.';
			return;
		} else {
			status = res.kind === 'not_found' ? (receivedAt ? 'degraded' : 'not_found') : 'retrying';
			failures++;
			delay =
				res.retryAfter !== undefined
					? Math.min(MAX_RETRY_AFTER_MS, res.retryAfter * 1000)
					: Math.min(MAX_BACKOFF_MS, POLL_MS * 2 ** Math.min(failures - 1, 4));
		}
		schedule(mySession, Math.max(MIN_POLL_MS, delay) + Math.random() * JITTER_MS);
	}

	function schedule(mySession: number, ms: number) {
		clearTimeout(pollTimer);
		nextDue = Date.now() + ms;
		pollTimer = setTimeout(() => poll(mySession), ms);
	}

	function updateGround(mySession: number, list: Pilot[]) {
		for (const p of list) {
			groundElevation(p.lng, p.lat).then((e) => {
				if (mySession !== session) return;
				// Skip results for a position the pilot has since left.
				const cur = pilots.find((x) => x.id === p.id);
				if (!cur || cur.lng !== p.lng || cur.lat !== p.lat) return;
				if (e === null) {
					if (p.id in ground) {
						delete ground[p.id];
						ground = ground;
					}
				} else if (ground[p.id] !== e) {
					ground = { ...ground, [p.id]: e };
				}
			});
		}
	}

	function onVisibility() {
		// Resume at the due time, so switching tabs back and forth never polls early.
		if (!document.hidden && groupId) schedule(session, Math.max(0, nextDue - Date.now()));
	}

	function setBase(layer: BaseLayer) {
		if (layer === baseLayer) return;
		baseLayer = layer;
		live?.setBaseLayer(layer);
	}

	function selectPilot(id: string) {
		selected = id;
		live?.flyToPilot(id);
	}

	let copied = '';
	let copiedTimer: ReturnType<typeof setTimeout> | undefined;

	function fmtPos(p: Pilot): string {
		return `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
	}

	function mapsUrl(p: Pilot): string {
		return `https://www.google.com/maps/search/?api=1&query=${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
	}

	async function copyPos(p: Pilot) {
		const text = fmtPos(p);
		try {
			await navigator.clipboard.writeText(text);
		} catch {
			// The Clipboard API needs a secure context; fall back to a selected textarea.
			const ta = document.createElement('textarea');
			ta.value = text;
			ta.setAttribute('readonly', '');
			Object.assign(ta.style, { position: 'fixed', opacity: '0' });
			document.body.appendChild(ta);
			ta.select();
			const ok = document.execCommand('copy');
			ta.remove();
			if (!ok) return;
		}
		copied = p.id;
		clearTimeout(copiedTimer);
		copiedTimer = setTimeout(() => (copied = ''), 1500);
	}

	function ageOf(p: Pilot): number {
		return p.age + Math.max(0, (now - receivedAt) / 1000);
	}

	function fmtAge(s: number): string {
		if (s < 60) return `${Math.round(s)}s ago`;
		if (s < 3600) return `${Math.floor(s / 60)}m ago`;
		return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m ago`;
	}

	function fmtAlt(m: number, u: typeof $units): string {
		return u === 'imperial'
			? `${Math.round(m * 3.28084).toLocaleString()} ft`
			: `${Math.round(m).toLocaleString()} m`;
	}

	$: live?.setUnits($units);

	function onWindowClick(e: MouseEvent) {
		if (settingsOpen && settingsEl && !settingsEl.contains(e.target as Node)) settingsOpen = false;
	}

	function onWindowKey(e: KeyboardEvent) {
		if (e.key === 'Escape') settingsOpen = false;
	}

	function swatch(id: string): string {
		const c = pilotColor?.(id);
		return c ? `rgb(${c[0]}, ${c[1]}, ${c[2]})` : '#888';
	}

	$: statusText = {
		idle: '',
		loading: 'Connecting…',
		live: 'Live',
		degraded: 'Live data paused, showing last known positions',
		retrying: 'Connection lost, retrying…',
		not_found: 'Waiting for the group'
	}[status];
</script>

<svelte:head>
	<title>{groupId ? `Group ${groupId} · xcNav Live` : 'xcNav Live'}</title>
	<meta name="description" content="Watch an xcNav flight group live on a 3D map." />
	<meta name="viewport" content="width=device-width, initial-scale=1" />
</svelte:head>

<svelte:window on:click={onWindowClick} on:keydown={onWindowKey} />

<div class="live">
	{#if !groupId}
		<div class="entry">
			<form class="card" on:submit|preventDefault={submit}>
				<h1>Watch a flight live</h1>
				<p>Enter the group code from the xcNav app to follow the pilots on a 3D map.</p>
				<label for="group">Group code</label>
				<div class="field">
					<input
						id="group"
						bind:value={input}
						placeholder="c21557"
						autocomplete="off"
						autocapitalize="off"
						spellcheck="false"
						maxlength="64"
						aria-invalid={inputError ? 'true' : undefined}
						aria-describedby={inputError ? 'group-error' : undefined}
					/>
					<button type="submit">Watch</button>
				</div>
				{#if inputError}
					<p class="error" id="group-error" role="alert">{inputError}</p>
				{/if}
				<a class="back" href="{base}/">Back to xcNav</a>
			</form>
		</div>
	{:else}
		<div class="map" bind:this={mapEl} />

		<div class="settings" bind:this={settingsEl}>
			<button
				class="gear"
				aria-label="Settings"
				aria-expanded={settingsOpen}
				aria-controls="settings-menu"
				on:click={() => (settingsOpen = !settingsOpen)}
			>
				<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
					<path
						fill="currentColor"
						d="M19.14 12.94a7.07 7.07 0 0 0 0-1.88l2.03-1.58a.5.5 0 0 0 .12-.64l-1.92-3.32a.5.5 0 0 0-.6-.22l-2.39.96a7 7 0 0 0-1.63-.94l-.36-2.54a.5.5 0 0 0-.5-.42h-3.84a.5.5 0 0 0-.49.42l-.36 2.54c-.59.24-1.13.56-1.63.94l-2.39-.96a.5.5 0 0 0-.6.22L2.71 8.84a.5.5 0 0 0 .12.64l2.03 1.58a7.07 7.07 0 0 0 0 1.88l-2.03 1.58a.5.5 0 0 0-.12.64l1.92 3.32c.13.22.39.3.6.22l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.54c.05.24.25.42.49.42h3.84c.25 0 .45-.18.49-.42l.36-2.54a7 7 0 0 0 1.63-.94l2.39.96c.22.08.48 0 .6-.22l1.92-3.32a.5.5 0 0 0-.12-.64l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z"
					/>
				</svg>
			</button>
			{#if settingsOpen}
				<div class="menu" id="settings-menu">
					<span class="menu-label" id="units-label">Units</span>
					<div class="segmented" role="group" aria-labelledby="units-label">
						<button aria-pressed={$units === 'imperial'} on:click={() => units.set('imperial')}>
							Imperial
						</button>
						<button aria-pressed={$units === 'metric'} on:click={() => units.set('metric')}>
							Metric
						</button>
					</div>
				</div>
			{/if}
		</div>

		<aside class="panel">
			<header>
				<div class="title">
					<span class="label">Group</span>
					<strong>{groupId}</strong>
				</div>
				<button class="link" on:click={changeGroup}>Change</button>
			</header>

			<div class="status" data-status={status} role="status">
				<span class="dot" />
				{statusText}
				{#if status === 'live' || status === 'degraded'}
					<span class="muted">· updated {fmtAge((now - receivedAt) / 1000)}</span>
				{/if}
			</div>

			<div class="segmented" role="group" aria-label="Base map">
				<button aria-pressed={baseLayer === 'outdoor'} on:click={() => setBase('outdoor')}>
					Outdoor
				</button>
				<button aria-pressed={baseLayer === 'satellite'} on:click={() => setBase('satellite')}>
					Satellite
				</button>
			</div>

			{#if mapError}
				<p class="error">{mapError}</p>
			{/if}

			{#if status === 'not_found'}
				<p class="note">
					No one has joined this group yet. It shows up as soon as a pilot in the group sends a
					position.
				</p>
			{:else if status === 'live' && pilots.length === 0}
				<p class="note">No pilot positions yet. They appear when pilots start sending them.</p>
			{/if}

			{#if pilots.length}
				<button
					class="list-toggle"
					aria-expanded={listOpen}
					on:click={() => (listOpen = !listOpen)}
				>
					Pilots ({pilots.length})
					<span aria-hidden="true">{listOpen ? '▴' : '▾'}</span>
				</button>
				{#if listOpen}
					<ul class="pilots">
						{#each pilots as p (p.id)}
							{@const age = ageOf(p)}
							<li class:selected={selected === p.id}>
								<button
									class="pilot"
									class:stale={!p.connected || age > staleAfter}
									class:selected={selected === p.id}
									aria-expanded={selected === p.id}
									on:click={() => selectPilot(p.id)}
								>
									<span class="swatch" style="background: {swatch(p.id)}" />
									<span class="who">
										<span class="name">{p.name}</span>
										<span class="meta">
											<span>MSL {fmtAlt(p.alt, $units)}</span>
											<span>
												AGL {p.id in ground ? fmtAlt(Math.max(0, p.alt - ground[p.id]), $units) : '…'}
											</span>
										</span>
									</span>
									<span class="age">
										{#if !p.connected}offline{:else}{fmtAge(age)}{/if}
									</span>
								</button>
								{#if selected === p.id}
									<div class="pos">
										<button
											class="coords"
											title="Copy coordinates"
											aria-label="Copy coordinates {fmtPos(p)}"
											on:click={() => copyPos(p)}
										>
											<span class="nums">{fmtPos(p)}</span>
											<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
												{#if copied === p.id}
													<path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z" />
												{:else}
													<path
														fill="currentColor"
														d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1Zm3 4H8a2 2 0 0 0-2 2v14c0 1.1.9 2 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2Zm0 16H8V7h11v14Z"
													/>
												{/if}
											</svg>
											<span class="hint" aria-live="polite">{copied === p.id ? 'Copied' : ''}</span>
										</button>
										<a href={mapsUrl(p)} target="_blank" rel="noopener noreferrer">
											Open in Google Maps<span aria-hidden="true"> ↗</span>
										</a>
									</div>
								{/if}
							</li>
						{/each}
					</ul>
					<button class="link fit" on:click={() => live?.frameAll()}>Show all pilots</button>
				{/if}
			{/if}
		</aside>
	{/if}
</div>

<style>
	.live {
		--panel-bg: rgba(255, 255, 255, 0.94);
		--panel-fg: #1d1f23;
		--muted: #5c636e;
		--border: rgba(0, 0, 0, 0.12);
		--accent: #ff5722;
		--ok: #2e9d4f;
		--warn: #d99100;
		--bad: #c62828;
		position: fixed;
		inset: 0;
		background: #dfe3e8;
		color: var(--panel-fg);
		text-align: left;
		font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
	}

	@media (prefers-color-scheme: dark) {
		.live {
			--panel-bg: rgba(28, 30, 34, 0.94);
			--panel-fg: #eef0f3;
			--muted: #a3a9b3;
			--border: rgba(255, 255, 255, 0.14);
			background: #15171a;
		}
	}

	.map {
		position: absolute;
		inset: 0;
	}

	/* Entry form */
	.entry {
		display: grid;
		place-items: center;
		height: 100%;
		padding: 16px;
		box-sizing: border-box;
	}
	.card {
		width: 100%;
		max-width: 420px;
		background: var(--panel-bg);
		border-radius: 14px;
		padding: 28px 24px;
		box-shadow: 0 10px 40px rgba(0, 0, 0, 0.15);
	}
	.card h1 {
		margin: 0 0 8px;
		font-size: 1.6rem;
	}
	.card p {
		margin: 0 0 20px;
		color: var(--muted);
		line-height: 1.4;
	}
	label {
		display: block;
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 6px;
	}
	.field {
		display: flex;
		gap: 8px;
	}
	input {
		flex: 1;
		min-width: 0;
		font: inherit;
		font-size: 1.15rem;
		letter-spacing: 0.06em;
		padding: 10px 12px;
		border: 1px solid var(--border);
		border-radius: 8px;
		background: transparent;
		color: inherit;
	}
	input:focus-visible,
	button:focus-visible {
		outline: 2px solid var(--accent);
		outline-offset: 2px;
	}
	button[type='submit'] {
		font: inherit;
		font-weight: 600;
		padding: 10px 18px;
		border: none;
		border-radius: 8px;
		background: var(--accent);
		color: #fff;
		cursor: pointer;
	}
	.error {
		color: var(--bad) !important;
		margin: 10px 0 0 !important;
		font-size: 0.9rem;
	}
	.back {
		display: inline-block;
		margin-top: 20px;
		color: var(--muted);
		font-size: 0.9rem;
	}

	/* Map panel */
	.panel {
		position: absolute;
		top: 12px;
		left: 12px;
		width: 300px;
		/* Leave room for the settings button at the top right. */
		max-width: calc(100vw - 76px);
		max-height: calc(100% - 24px - 30px);
		overflow-y: auto;
		box-sizing: border-box;
		padding: 14px;
		background: var(--panel-bg);
		border-radius: 12px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
		z-index: 2;
	}
	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
	}
	.title .label {
		color: var(--muted);
		font-size: 0.8rem;
		margin-right: 6px;
	}
	.title strong {
		font-size: 1.15rem;
		letter-spacing: 0.04em;
	}
	.link {
		font: inherit;
		font-size: 0.9rem;
		background: none;
		border: none;
		color: var(--accent);
		cursor: pointer;
		padding: 4px;
	}
	.status {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 6px;
		margin: 8px 0 12px;
		font-size: 0.9rem;
	}
	.dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: var(--muted);
		flex: none;
	}
	.status[data-status='live'] .dot {
		background: var(--ok);
		box-shadow: 0 0 0 3px rgba(46, 157, 79, 0.25);
	}
	.status[data-status='degraded'] .dot,
	.status[data-status='not_found'] .dot {
		background: var(--warn);
	}
	.status[data-status='retrying'] .dot {
		background: var(--bad);
	}
	.muted {
		color: var(--muted);
	}
	.settings {
		position: absolute;
		top: 12px;
		right: 12px;
		z-index: 3;
	}
	.gear {
		display: grid;
		place-items: center;
		width: 40px;
		height: 40px;
		padding: 0;
		border: none;
		border-radius: 10px;
		background: var(--panel-bg);
		color: var(--panel-fg);
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
		cursor: pointer;
	}
	.gear[aria-expanded='true'] {
		color: var(--accent);
	}
	.menu {
		position: absolute;
		top: 48px;
		right: 0;
		width: 220px;
		max-width: calc(100vw - 24px);
		box-sizing: border-box;
		padding: 12px;
		background: var(--panel-bg);
		border-radius: 12px;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.18);
	}
	.menu-label {
		display: block;
		font-size: 0.85rem;
		font-weight: 600;
		margin-bottom: 6px;
	}
	.segmented {
		display: flex;
		border: 1px solid var(--border);
		border-radius: 8px;
		overflow: hidden;
	}
	.segmented button {
		flex: 1;
		font: inherit;
		font-size: 0.9rem;
		padding: 7px 0;
		border: none;
		background: transparent;
		color: inherit;
		cursor: pointer;
	}
	.segmented button[aria-pressed='true'] {
		background: var(--accent);
		color: #fff;
		font-weight: 600;
	}
	.note {
		font-size: 0.9rem;
		color: var(--muted);
		line-height: 1.4;
		margin: 12px 0 0;
	}
	.list-toggle {
		display: flex;
		justify-content: space-between;
		width: 100%;
		margin-top: 14px;
		padding: 4px 0;
		font: inherit;
		font-weight: 600;
		background: none;
		border: none;
		color: inherit;
		cursor: pointer;
	}
	.pilots {
		list-style: none;
		margin: 6px 0 0;
		padding: 0;
	}
	.pilot {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 8px 6px;
		border: none;
		border-radius: 8px;
		background: transparent;
		color: inherit;
		font: inherit;
		text-align: left;
		cursor: pointer;
	}
	.pilot:hover,
	.pilot.selected {
		background: rgba(127, 127, 127, 0.14);
	}
	.pilot.stale {
		opacity: 0.6;
	}
	.swatch {
		width: 12px;
		height: 12px;
		border-radius: 50%;
		flex: none;
	}
	.who {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.name {
		font-weight: 600;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
	.meta,
	.age {
		font-size: 0.8rem;
		color: var(--muted);
		font-variant-numeric: tabular-nums;
	}
	.age {
		flex: none;
	}
	.meta {
		display: flex;
		flex-direction: column;
	}
	/* The selected pilot's card wraps its row and the position line below it. */
	li.selected {
		border-radius: 8px;
		background: rgba(127, 127, 127, 0.14);
	}
	li.selected .pilot {
		background: transparent;
	}
	.pos {
		display: flex;
		flex-direction: column;
		align-items: flex-start;
		gap: 4px;
		/* Line up with the pilot name: row padding 6px + swatch 12px + gap 10px. */
		padding: 0 6px 10px 28px;
		font-size: 0.8rem;
	}
	.coords {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		padding: 0;
		font: inherit;
		text-align: left;
		white-space: nowrap;
		background: none;
		border: none;
		color: var(--muted);
		cursor: pointer;
	}
	.nums {
		font-variant-numeric: tabular-nums;
	}
	.coords:hover {
		color: inherit;
	}
	.hint {
		color: var(--accent);
		font-weight: 600;
	}
	.pos a {
		flex: none;
		color: var(--accent);
		text-decoration: none;
	}
	.pos a:hover {
		text-decoration: underline;
	}
	.fit {
		margin-top: 6px;
	}

	@media (max-width: 600px) {
		.panel {
			top: 8px;
			left: 8px;
			right: 8px;
			width: auto;
			max-width: none;
			max-height: 45%;
			padding: 12px;
		}
	}
</style>
