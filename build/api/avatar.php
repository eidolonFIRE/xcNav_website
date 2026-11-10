<?php
/**
 * GET /api/avatar.php?g=<group_id>&p=<pilot_id>&h=<avatarHash>
 *
 * Serves a pilot's avatar image from the profile store, cached on disk.
 * Only pilots in a group snapshot we already hold are served, with the matching hash,
 * so this endpoint cannot be used to query the profile store for arbitrary ids.
 */

declare(strict_types=1);

require __DIR__ . '/_common.php';

/** Avatars change hash when they change, so a cached file is kept as long as cleanup allows. */
const XC_AVATAR_MISS_TTL = 600;
const XC_AVATAR_MAX_BYTES = 1048576;

xc_require_get();
$groupId = xc_param('g', XC_ID_RE, 'Invalid request.');
$pilotId = xc_param('p', XC_ID_RE, 'Invalid request.');
$hash = xc_param('h', XC_HASH_RE, 'Invalid request.');

xc_load_config();
$storeUrl = xc_config('PROFILE_STORE_URL');
$storeToken = xc_config('PROFILE_STORE_TOKEN');
if (!is_string($storeUrl) || $storeUrl === '' || !is_string($storeToken) || $storeToken === '') {
    xc_fail(404, 'Not found.');
}

// The pilot must be in a group snapshot we fetched, with this exact avatar hash.
$state = xc_read_json(xc_group_cache_path($groupId));
$pilot = $state['pilots'][$pilotId] ?? null;
if (!is_array($pilot) || ($pilot['avatarHash'] ?? null) !== $hash) {
    xc_fail(404, 'Not found.');
}

$key = substr(hash('sha256', strtolower($pilotId) . '|' . $hash), 0, 32);
$imagePath = xc_cache_dir() . '/avatar_' . $key . '.img';
$missPath = xc_cache_dir() . '/avatar_' . $key . '.miss';

$cached = function () use ($imagePath, $missPath) {
    if (is_file($imagePath)) {
        return 'hit';
    }
    $missAt = @filemtime($missPath);
    if ($missAt !== false && time() - $missAt < XC_AVATAR_MISS_TTL) {
        return 'miss';
    }
    return null;
};

$result = $cached();
if ($result === null) {
    $result = xc_locked_refresh($imagePath . '.lock', $cached, function () use ($pilotId, $storeUrl, $storeToken, $imagePath, $missPath) {
        $bytes = xc_fetch_avatar($pilotId, $storeUrl, $storeToken);
        if ($bytes === null) {
            @touch($missPath);
            return 'miss';
        }
        xc_write_atomic($imagePath, $bytes);
        @unlink($missPath);
        return 'hit';
    });
}

if ($result !== 'hit') {
    xc_fail(404, 'Not found.');
}

$bytes = @file_get_contents($imagePath);
$mime = $bytes === false ? null : xc_image_mime($bytes);
if ($mime === null) {
    xc_fail(404, 'Not found.');
}
http_response_code(200);
header('Content-Type: ' . $mime);
header('Content-Length: ' . strlen($bytes));
header('Cache-Control: public, max-age=86400');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'");
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
    echo $bytes;
}


// ---------------------------------------------------------------------------

/** Detect an allowed image type from its first bytes. */
function xc_image_mime(string $bytes): ?string
{
    if (strncmp($bytes, "\xFF\xD8\xFF", 3) === 0) {
        return 'image/jpeg';
    }
    if (strncmp($bytes, "\x89PNG\r\n\x1A\n", 8) === 0) {
        return 'image/png';
    }
    if (strncmp($bytes, 'GIF87a', 6) === 0 || strncmp($bytes, 'GIF89a', 6) === 0) {
        return 'image/gif';
    }
    if (strncmp($bytes, 'RIFF', 4) === 0 && substr($bytes, 8, 4) === 'WEBP') {
        return 'image/webp';
    }
    return null;
}

/**
 * Fetch one avatar from the profile store, the same way the xcNav app does:
 * GET https://<host>/<last path segment>?pilot_id=<id> with an `authorizationToken` header,
 * answered with JSON {"avatar": "<base64 image>"}.
 * PROFILE_STORE_URL uses the app's format: "<host>/.../<name>", no scheme.
 */
function xc_fetch_avatar(string $pilotId, string $storeUrl, string $storeToken): ?string
{
    $storeUrl = preg_replace('#^https?://#i', '', trim($storeUrl)) ?? '';
    $parts = explode('/', $storeUrl);
    $host = $parts[0];
    $path = end($parts);
    if ($host === '' || !preg_match('/^[A-Za-z0-9.-]+$/', $host)) {
        error_log('xcnav api: PROFILE_STORE_URL is malformed');
        return null;
    }
    $url = 'https://' . $host . '/' . ($path !== $host ? rawurlencode($path) : '')
        . '?pilot_id=' . rawurlencode(strtolower($pilotId));

    $ch = curl_init($url);
    if ($ch === false) {
        return null;
    }
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER => ['authorizationToken: ' . $storeToken, 'Accept: application/json'],
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT => 10,
        CURLOPT_FOLLOWLOCATION => false,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $body = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $errno = curl_errno($ch);
    curl_close($ch);

    if ($errno !== 0 || !is_string($body)) {
        error_log('xcnav api: profile store request failed, curl errno ' . $errno);
        return null;
    }
    if ($status < 200 || $status >= 300) {
        if ($status !== 404) {
            error_log('xcnav api: profile store returned HTTP ' . $status);
        }
        return null;
    }
    if (strlen($body) > XC_AVATAR_MAX_BYTES * 2) {
        return null;
    }
    $data = json_decode($body, true);
    $b64 = is_array($data) ? ($data['avatar'] ?? null) : null;
    if (!is_string($b64) || $b64 === '') {
        return null;
    }
    $bytes = base64_decode($b64, true);
    if ($bytes === false || strlen($bytes) > XC_AVATAR_MAX_BYTES || xc_image_mime($bytes) === null) {
        return null;
    }
    return $bytes;
}
