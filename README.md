# create-svelte

Everything you need to build a Svelte project, powered by [`create-svelte`](https://github.com/sveltejs/kit/tree/master/packages/create-svelte).

## Creating a project

If you're seeing this, you've probably already done this step. Congrats!

```bash
# create a new project in the current directory
npm create svelte@latest

# create a new project in my-app
npm create svelte@latest my-app
```

## Developing

Once you've created a project and installed dependencies with `npm install` (or `pnpm install` or `yarn`), start a development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```

## Building

To create a production version of your app:

```bash
npm run build
```

You can preview the production build with `npm run preview`.

> To deploy your app, you may need to install an [adapter](https://kit.svelte.dev/docs/adapters) for your target environment.

# NOTES
`netsh interface portproxy add v4tov4 listenport=5173 connectaddress=172.26.152.88 connectport=5173`
# Live group viewer (`/live/`)

Spectators enter a group code and watch pilots on a 3D map (MapTiler outdoor or hybrid satellite, with terrain).
Pilot paths are drawn at their real altitude.

- Frontend: `src/routes/live/` and `src/lib/live/` (MapLibre GL for the map and terrain, deck.gl for the 3D pilots and paths).
- API: `static/api/*.php`, copied to `build/api/` by `npm run build`. The browser only calls these PHP files.
  The reflector token and the profile store token never reach the browser.
  - `group.php?g=<id>&since=<cursor>` calls the reflector at most once every 15 s per group.
    It uses a disk cache and `flock`, and builds pilot tracks from the snapshots it fetches.
  - `avatar.php?g=&p=&h=` proxies and caches pilot avatars from the profile store.
    It only serves pilots that are in a cached group snapshot.
  - Rate limits, so viewers cannot overload the reflector or the DreamHost account:
    - Each client (IP address, or IPv6 /64) may make 60 API requests per minute. Over that, the API sends 429 with `Retry-After`.
    - Each client may cause 10 reflector fetches per minute, and the whole site 120. Over budget, the API serves the last snapshot
      without refreshing it, or 429 if it has none. This stops anyone from probing many group codes through the reflector.
    - After a reflector error (network, TLS, or HTTP other than 200/404/400), the API waits 15 s before it calls the reflector again,
      doubling per error up to 5 min. Viewers see the last snapshot in the meantime.
    - Limits can be changed in the config file. See `server/xcnav-config.example.php`.
    - The browser polls when the server says its next refresh is due (`next` in the response), with random jitter.
      It backs off on errors up to 60 s, honors `Retry-After`, and does not poll while the tab is hidden.

## Deploy on DreamHost

1. Build with `npm run build`, then upload the contents of `build/` to the domain's web folder (`/home/<user>/<domain>/`).
2. Create the secrets file outside the web folder:
   ```bash
   mkdir -p ~/secrets && chmod 700 ~/secrets
   cp server/xcnav-config.example.php ~/secrets/xcnav-config.php   # then edit it
   chmod 600 ~/secrets/xcnav-config.php
   ```
   The API looks for `dirname(DOCUMENT_ROOT)/secrets/xcnav-config.php`, which is `/home/<user>/secrets/xcnav-config.php`.
   To use another path, set the `XCNAV_CONFIG` environment variable.
3. The cache is written to `/home/<user>/xcnav-cache/`, which is created on first use.
   To change it, set `XCNAV_CACHE_DIR` in the config.
4. In the MapTiler dashboard, restrict the API key to this site's domains. The key must be public because every tile request carries it.

Requirements: PHP 7.4 or later, with the curl and mbstring extensions.
