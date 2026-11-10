import { request } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

// Local testing: `npm run dev:api` runs static/api/*.php on PHP's built-in server.
// This forwards /api/* to it so the page talks to the same PHP code as in production.
// Vite's own `server.proxy` cannot be used: SvelteKit serves static/ first and would
// return the PHP source instead of running it.
const PHP_DEV_SERVER = { host: '127.0.0.1', port: 8080 };

function phpApiProxy(): Plugin {
	const middleware: Connect.NextHandleFunction = (req, res, next) => {
		if (!req.url?.startsWith('/api/')) return next();
		const upstream = request(
			{ ...PHP_DEV_SERVER, path: req.url, method: req.method, headers: req.headers },
			(up) => {
				res.writeHead(up.statusCode ?? 502, up.headers);
				up.pipe(res);
			}
		);
		upstream.on('error', () => {
			res.statusCode = 502;
			res.setHeader('Content-Type', 'application/json');
			res.end('{"error":"PHP dev server is not running. Start it with: npm run dev:api"}');
		});
		req.pipe(upstream);
	};
	return {
		name: 'php-api-proxy',
		configureServer: (server) => void server.middlewares.use(middleware),
		configurePreviewServer: (server) => void server.middlewares.use(middleware)
	};
}

export default defineConfig({
	// Must come before sveltekit() so its middleware runs first.
	plugins: [phpApiProxy(), sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}']
	}
});
