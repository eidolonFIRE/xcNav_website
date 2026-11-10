<?php
/**
 * GET /api/group.php?g=<group_id>[&since=<seconds>]
 *
 * Returns a reshaped snapshot of a flight group for the spectator map.
 * - The reflector is called at most once per XC_GROUP_TTL per group. Other requests read the disk cache.
 * - The reflector only returns current positions, so tracks are built here from the snapshots we fetch.
 * - `since` (the `cursor` from an earlier response) limits track points to ones added after it.
 * - Rate limits: requests per client, reflector fetches per client and for the whole site, and a
 *   backoff after reflector errors. Over a fetch budget, the last snapshot is served unchanged.
 * - `next` in the response tells the client how many seconds to wait before it polls again.
 */

declare(strict_types=1);

require __DIR__ . '/_common.php';

xc_require_get();
xc_load_config();
xc_rate_limit_request();
$groupId = xc_param('g', XC_ID_RE, 'Invalid group code.');
$since = isset($_GET['since']) && is_string($_GET['since']) && is_numeric($_GET['since'])
    ? (float) $_GET['since']
    : 0.0;

if (!defined('GROUP_API_TOKEN') || !is_string(GROUP_API_TOKEN) || GROUP_API_TOKEN === '') {
    throw new RuntimeException('GROUP_API_TOKEN is not configured');
}

$cachePath = xc_group_cache_path($groupId);
$isFresh = function () use ($cachePath): ?array {
    $state = xc_read_json($cachePath);
    if ($state !== null && ($state['v'] ?? 0) === 1 && microtime(true) - (float) ($state['fetched'] ?? 0) < XC_GROUP_TTL) {
        return $state;
    }
    return null;
};

$state = $isFresh();
if ($state === null) {
    $state = xc_locked_refresh($cachePath . '.lock', $isFresh, function () use ($cachePath, $groupId): array {
        $prev = xc_read_json($cachePath);
        $wait = xc_reflector_budget();
        if ($wait > 0) {
            // Over budget. Serve the last snapshot without writing it, so the next request
            // within budget still refreshes it. A throttled client can never delay a refresh.
            if ($prev !== null && ($prev['v'] ?? 0) === 1) {
                $prev['throttled'] = $wait;
                return $prev;
            }
            return ['v' => 0, 'throttled' => $wait];
        }
        $state = xc_refresh_group($groupId, $prev);
        xc_write_atomic($cachePath, json_encode($state, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE));
        return $state;
    });
}

if (($state['v'] ?? 0) !== 1) {
    xc_too_many((float) ($state['throttled'] ?? XC_GROUP_TTL));
}

xc_maybe_cleanup();
xc_respond($groupId, $state, $since);


// ---------------------------------------------------------------------------

/**
 * Call the reflector unless it failed recently. Returns [httpStatus, decodedBody|null],
 * or [0, null] on an error or while backing off.
 * Each error doubles the wait before the next call, from XC_BACKOFF_MIN up to XC_BACKOFF_MAX.
 * 404 and 400 are normal answers for unknown groups and do not count as errors.
 */
function xc_fetch_reflector(string $groupId): array
{
    $path = xc_cache_dir() . '/reflector_backoff.json';
    $backoff = xc_read_json($path);
    if ($backoff !== null && microtime(true) < (float) ($backoff['until'] ?? 0)) {
        return [0, null];
    }

    [$status, $data] = xc_request_reflector($groupId);

    if ($status === 200 || $status === 404 || $status === 400) {
        if ($backoff !== null) {
            @unlink($path);
        }
    } else {
        $fails = (int) ($backoff['fails'] ?? 0) + 1;
        $delay = min(XC_BACKOFF_MAX, XC_BACKOFF_MIN * 2 ** min($fails - 1, 10));
        error_log('xcnav api: reflector error ' . $fails . ' in a row, next call in ' . (int) $delay . ' s');
        try {
            xc_write_atomic($path, (string) json_encode(['fails' => $fails, 'until' => microtime(true) + $delay]));
        } catch (RuntimeException $e) {
            error_log('xcnav api: cannot save reflector backoff');
        }
    }
    return [$status, $data];
}

/**
 * Make one reflector request. Returns [httpStatus, decodedBody|null], or [0, null] on a network or TLS error.
 */
function xc_request_reflector(string $groupId): array
{
    $ch = curl_init(XC_REFLECTOR_URL . rawurlencode($groupId));
    if ($ch === false) {
        return [0, null];
    }
    $ok = curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['Authorization: Bearer ' . GROUP_API_TOKEN, 'Accept: application/json'],
        // The reflector cert is self-signed and expired. The public key pin below is the trust anchor.
        // Never remove CURLOPT_PINNEDPUBLICKEY.
        CURLOPT_SSL_VERIFYPEER => false,
        CURLOPT_SSL_VERIFYHOST => 0,
        CURLOPT_PINNEDPUBLICKEY => XC_REFLECTOR_PIN,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
    ]);
    if (!$ok) {
        // If curl cannot apply the pin, refuse to talk to the server at all.
        curl_close($ch);
        error_log('xcnav api: curl options rejected (public key pinning unsupported?)');
        return [0, null];
    }
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $errno = curl_errno($ch);
    curl_close($ch);
    if ($errno !== 0 || !is_string($body)) {
        error_log('xcnav api: reflector request failed, curl errno ' . $errno);
        return [0, null];
    }
    if ($status !== 200) {
        if ($status !== 404) {
            error_log('xcnav api: reflector returned HTTP ' . $status);
        }
        return [$status, null];
    }
    $data = json_decode($body, true);
    if (!is_array($data)) {
        error_log('xcnav api: reflector returned invalid JSON');
        return [0, null];
    }
    return [200, $data];
}

function xc_num($value): ?float
{
    if (is_int($value) || is_float($value)) {
        $f = (float) $value;
        return is_finite($f) ? $f : null;
    }
    return null;
}

function xc_str($value, int $maxLen): string
{
    if (!is_string($value)) {
        return '';
    }
    $value = preg_replace('/[\x00-\x1F\x7F]/u', '', $value) ?? '';
    $value = trim($value);
    return function_exists('mb_substr') ? mb_substr($value, 0, $maxLen) : substr($value, 0, $maxLen);
}

/** Convert a 32-bit ARGB integer into [#rrggbb, alpha 0..1]. */
function xc_argb($value): array
{
    if (!is_int($value) && !is_float($value)) {
        return ['#3388ff', 1.0];
    }
    $v = ((int) $value) & 0xFFFFFFFF;
    $a = ($v >> 24) & 0xFF;
    return [sprintf('#%06x', $v & 0xFFFFFF), round($a / 255, 3)];
}

function xc_reshape_waypoints($raw): array
{
    if (!is_array($raw)) {
        return [];
    }
    $out = [];
    foreach ($raw as $key => $wp) {
        if (!is_array($wp) || !isset($wp['latlng']) || !is_array($wp['latlng'])) {
            continue;
        }
        $points = [];
        foreach ($wp['latlng'] as $ll) {
            if (!is_array($ll) || count($ll) < 2) {
                continue;
            }
            $lat = xc_num($ll[0]);
            $lng = xc_num($ll[1]);
            if ($lat === null || $lng === null || abs($lat) > 90 || abs($lng) > 180) {
                continue;
            }
            $points[] = [round($lng, 6), round($lat, 6)];
            if (count($points) >= 5000) {
                break;
            }
        }
        if (!$points) {
            continue;
        }
        [$color, $alpha] = xc_argb($wp['color'] ?? null);
        $icon = isset($wp['icon']) && is_string($wp['icon']) && preg_match('/^[A-Za-z0-9_-]{1,32}$/', $wp['icon']) ? $wp['icon'] : null;
        $out[] = [
            'id' => xc_str($wp['id'] ?? (string) $key, 64),
            'name' => xc_str($wp['name'] ?? '', 64),
            'icon' => $icon,
            'color' => $color,
            'opacity' => $alpha > 0 ? $alpha : 1.0,
            'points' => $points, // [lng, lat]
        ];
        if (count($out) >= 500) {
            break;
        }
    }
    return $out;
}

/**
 * Fetch the reflector and merge the result into the previous state.
 * Pilots and tracks are kept across reflector restarts, which return no pilots or 404 for a while.
 */
function xc_refresh_group(string $groupId, ?array $prev): array
{
    $now = microtime(true);
    if ($prev === null || ($prev['v'] ?? 0) !== 1) {
        $prev = null;
    }
    $pilots = $prev['pilots'] ?? [];
    $tracks = $prev['tracks'] ?? [];
    $waypoints = $prev['waypoints'] ?? [];
    $lastOk = (float) ($prev['lastOk'] ?? 0);

    [$status, $data] = xc_fetch_reflector($groupId);

    if ($status === 200) {
        $lastOk = $now;
        $waypoints = xc_reshape_waypoints($data['waypoints'] ?? []);
        foreach (is_array($data['pilots'] ?? null) ? $data['pilots'] : [] as $p) {
            if (!is_array($p) || !is_string($p['id'] ?? null) || !preg_match(XC_ID_RE, $p['id'])) {
                continue;
            }
            $lat = xc_num($p['lat'] ?? null);
            $lng = xc_num($p['lng'] ?? null);
            $alt = xc_num($p['alt'] ?? null) ?? 0.0;
            $age = max(0.0, xc_num($p['age'] ?? null) ?? 0.0);
            $clientTs = xc_num($p['timestamp'] ?? null) ?? 0.0;
            if ($lat === null || $lng === null || abs($lat) > 90 || abs($lng) > 180 || ($lat == 0 && $lng == 0)) {
                continue;
            }
            $id = $p['id'];
            // Receive time on our own clock, so ages never mix two servers' clocks.
            $rx = round($now - $age, 1);
            $hash = is_string($p['avatarHash'] ?? null) && preg_match(XC_HASH_RE, $p['avatarHash']) ? $p['avatarHash'] : null;
            $prevPilot = $pilots[$id] ?? null;
            $isNewFix = $prevPilot === null || $clientTs > (float) ($prevPilot['ts'] ?? 0);

            $pilots[$id] = [
                'id' => $id,
                'name' => xc_str($p['name'] ?? '', 48),
                'avatarHash' => $hash,
                'connected' => (bool) ($p['connected'] ?? false),
                'rx' => $isNewFix ? $rx : (float) ($prevPilot['rx'] ?? $rx),
                'ts' => $clientTs,
                'lat' => round($lat, 6),
                'lng' => round($lng, 6),
                'alt' => round($alt, 1),
            ];
            if ($isNewFix) {
                // [lng, lat, alt, receive time, snapshot time]. The last field drives `since`.
                $tracks[$id][] = [round($lng, 6), round($lat, 6), round($alt, 1), $rx, round($now, 3)];
            }
        }
    }

    // Drop anything older than the reflector keeps.
    $cutoff = $now - XC_MAX_AGE;
    foreach ($pilots as $id => $p) {
        if ((float) ($p['rx'] ?? 0) < $cutoff) {
            unset($pilots[$id], $tracks[$id]);
        }
    }
    foreach ($tracks as $id => $points) {
        $points = array_values(array_filter($points, function ($pt) use ($cutoff) {
            return (float) $pt[3] >= $cutoff;
        }));
        if (count($points) > XC_MAX_TRACK_POINTS) {
            $points = array_slice($points, -XC_MAX_TRACK_POINTS);
        }
        if ($points && isset($pilots[$id])) {
            $tracks[$id] = $points;
        } else {
            unset($tracks[$id]);
        }
    }

    if ($status === 200) {
        $result = 'ok';
    } elseif ($lastOk > 0 && $now - $lastOk < XC_DEGRADED_GRACE) {
        // Reflector restarting (404) or unreachable: keep showing what we last saw.
        $result = 'degraded';
    } elseif ($status === 404 || $status === 400) {
        $result = 'not_found';
    } else {
        $result = 'unavailable';
    }

    return [
        'v' => 1,
        'fetched' => $now,
        'status' => $result,
        'lastOk' => $lastOk,
        'pilots' => $pilots,
        'tracks' => $tracks,
        'waypoints' => $waypoints,
    ];
}

function xc_respond(string $groupId, array $state, float $since): void
{
    $status = $state['status'] ?? 'unavailable';
    if ($status === 'not_found') {
        xc_send_json(404, ['error' => 'Group not found.'], 'no-cache');
        return;
    }
    if ($status === 'unavailable') {
        header('Retry-After: 30');
        xc_send_json(503, ['error' => 'Live data is unavailable right now.'], 'no-store');
        return;
    }

    $now = microtime(true);
    // Seconds until this snapshot goes stale, or until the client's fetch budget allows a refresh.
    $next = max(1.0, (float) $state['fetched'] + XC_GROUP_TTL - $now, (float) ($state['throttled'] ?? 0));
    $avatars = is_string(xc_config('PROFILE_STORE_URL')) && xc_config('PROFILE_STORE_URL') !== '';
    $pilots = [];
    foreach ($state['pilots'] ?? [] as $id => $p) {
        $track = [];
        foreach ($state['tracks'][$id] ?? [] as $pt) {
            if ((float) ($pt[4] ?? 0) > $since) {
                $track[] = [$pt[0], $pt[1], $pt[2], $pt[3]];
            }
        }
        $pilots[] = [
            'id' => (string) $id,
            'name' => $p['name'] !== '' ? $p['name'] : 'Pilot',
            'connected' => $p['connected'],
            'age' => max(0, (int) round($now - (float) $p['rx'])),
            'lat' => $p['lat'],
            'lng' => $p['lng'],
            'alt' => $p['alt'],
            'avatar' => $avatars ? $p['avatarHash'] : null,
            'track' => $track, // [lng, lat, altMeters, serverTime]
        ];
    }
    usort($pilots, function ($a, $b) {
        return strcasecmp($a['name'], $b['name']);
    });

    xc_send_json(200, [
        'group' => $groupId,
        'serverTime' => round($now, 1),
        // Pass back as `since` to get only track points added after this snapshot.
        'cursor' => round((float) $state['fetched'], 3),
        'degraded' => $status === 'degraded',
        // Seconds to wait before polling again.
        'next' => round($next, 1),
        'pilots' => $pilots,
        'waypoints' => $state['waypoints'] ?? [],
    ]);
}
