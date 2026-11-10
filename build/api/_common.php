<?php
/**
 * Shared helpers for the xcNav spectator API.
 *
 * This file only defines functions. The .htaccess in this folder blocks direct
 * requests to it, and the guard below makes a direct request do nothing.
 *
 * Secrets live OUTSIDE the web root. See server/xcnav-config.example.php in the
 * repository for the template and the deploy notes in README.md.
 */

declare(strict_types=1);

if (realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    http_response_code(404);
    exit;
}

// Never leak warnings, paths or upstream details to the browser.
ini_set('display_errors', '0');
ini_set('display_startup_errors', '0');
ini_set('log_errors', '1');
error_reporting(E_ALL);

const XC_ID_RE = '/^[A-Za-z0-9_-]{1,64}$/';
const XC_HASH_RE = '/^[A-Za-z0-9]{1,128}$/';

/** Seconds a group snapshot stays fresh before one request refreshes it. */
const XC_GROUP_TTL = 15.0;
/** Positions and track points older than this are dropped (matches the reflector). */
const XC_MAX_AGE = 12 * 3600;
/** Upper bound on track points kept per pilot. */
const XC_MAX_TRACK_POINTS = 4000;
/** Keep showing the last good snapshot this long while the reflector is down or restarting. */
const XC_DEGRADED_GRACE = 30 * 60;

/*
 * Rate limits. Each can be changed in the config file by defining the XCNAV_* constant named below.
 * A "client" is one IP address, or one /64 network for IPv6.
 */
/** API requests per minute per client (XCNAV_RATE_PER_MIN). Bursts up to the same number are allowed. */
const XC_RATE_PER_MIN = 60;
/** Reflector fetches one client may cause per minute (XCNAV_CLIENT_REFRESH_PER_MIN). */
const XC_CLIENT_REFRESH_PER_MIN = 10;
const XC_CLIENT_REFRESH_BURST = 10;
/** Reflector fetches per minute for the whole site (XCNAV_REFLECTOR_PER_MIN). */
const XC_REFLECTOR_PER_MIN = 120;
const XC_REFLECTOR_BURST = 30;
/** After a reflector error, wait this long before calling it again. Doubles per error up to the max. */
const XC_BACKOFF_MIN = 15.0;
const XC_BACKOFF_MAX = 300.0;

const XC_REFLECTOR_URL = 'https://ec2-54-177-162-94.us-west-1.compute.amazonaws.com/group/';
const XC_REFLECTOR_PIN = 'sha256//x01uRX7Jy3czU2H+cSefO0XYf+uL7dYakGHhOcftzmU=';

set_exception_handler(function (Throwable $e): void {
    error_log('xcnav api: ' . get_class($e) . ': ' . $e->getMessage());
    if (!headers_sent()) {
        xc_fail(500, 'Something went wrong. Please try again.');
    }
    exit;
});

/** Load the secrets file from outside the web root. */
function xc_load_config(): void
{
    static $loaded = false;
    if ($loaded) {
        return;
    }
    $candidates = [];
    $env = getenv('XCNAV_CONFIG');
    if (is_string($env) && $env !== '') {
        $candidates[] = $env;
    }
    $docRoot = $_SERVER['DOCUMENT_ROOT'] ?? '';
    if ($docRoot !== '') {
        // DreamHost: DOCUMENT_ROOT is /home/<user>/<domain>, so this is /home/<user>/secrets/.
        $candidates[] = dirname(rtrim($docRoot, '/')) . '/secrets/xcnav-config.php';
    }
    foreach ($candidates as $path) {
        if (is_file($path) && is_readable($path)) {
            require_once $path;
            $loaded = true;
            return;
        }
    }
    throw new RuntimeException('config file not found');
}

function xc_config(string $name, $default = null)
{
    return defined($name) ? constant($name) : $default;
}

/** Cache directory outside the web root, created on first use. */
function xc_cache_dir(): string
{
    static $dir = null;
    if ($dir !== null) {
        return $dir;
    }
    $candidate = xc_config('XCNAV_CACHE_DIR');
    if (!is_string($candidate) || $candidate === '') {
        $docRoot = $_SERVER['DOCUMENT_ROOT'] ?? '';
        $candidate = $docRoot !== ''
            ? dirname(rtrim($docRoot, '/')) . '/xcnav-cache'
            : sys_get_temp_dir() . '/xcnav-cache';
    }
    if (!is_dir($candidate) && !@mkdir($candidate, 0700, true) && !is_dir($candidate)) {
        throw new RuntimeException('cannot create cache dir');
    }
    $dir = rtrim($candidate, '/');
    return $dir;
}

function xc_send_json(int $status, array $body, string $cacheControl = 'no-cache'): void
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: ' . $cacheControl);
    header('X-Content-Type-Options: nosniff');
    echo json_encode($body, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_PRESERVE_ZERO_FRACTION | JSON_INVALID_UTF8_SUBSTITUTE);
}

/** Send a generic error and stop. Never include upstream details. */
function xc_fail(int $status, string $message): void
{
    xc_send_json($status, ['error' => $message], 'no-store');
    exit;
}

function xc_require_get(): void
{
    $method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($method !== 'GET' && $method !== 'HEAD') {
        header('Allow: GET, HEAD');
        xc_fail(405, 'Method not allowed.');
    }
}

/** Read a query parameter as a string and validate it, or fail with 400. */
function xc_param(string $name, string $regex, string $message): string
{
    $value = $_GET[$name] ?? null;
    if (!is_string($value) || !preg_match($regex, $value)) {
        xc_fail(400, $message);
    }
    return $value;
}

/** Read a JSON file, or null if it is missing or corrupt. */
function xc_read_json(string $path): ?array
{
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return null;
    }
    $data = json_decode($raw, true);
    return is_array($data) ? $data : null;
}

/** Write a file atomically so readers never see a partial file. */
function xc_write_atomic(string $path, string $contents): void
{
    $tmp = $path . '.' . bin2hex(random_bytes(6)) . '.tmp';
    if (@file_put_contents($tmp, $contents) === false) {
        throw new RuntimeException('cache write failed');
    }
    @chmod($tmp, 0600);
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        throw new RuntimeException('cache rename failed');
    }
}

/**
 * Run $refresh under an exclusive lock unless the cache became fresh while waiting.
 * $isFresh is checked again after the lock is held, so concurrent requests cause one refresh.
 */
function xc_locked_refresh(string $lockPath, callable $isFresh, callable $refresh)
{
    $lock = @fopen($lockPath, 'c');
    if ($lock === false) {
        throw new RuntimeException('cannot open lock');
    }
    try {
        if (!flock($lock, LOCK_EX)) {
            throw new RuntimeException('cannot lock');
        }
        $fresh = $isFresh();
        if ($fresh !== null) {
            return $fresh;
        }
        return $refresh();
    } finally {
        flock($lock, LOCK_UN);
        fclose($lock);
    }
}

/** Send 429 with a Retry-After header and stop. */
function xc_too_many(float $wait): void
{
    header('Retry-After: ' . (string) max(1, (int) ceil($wait)));
    xc_fail(429, 'Too many requests. Please wait a moment.');
}

/** Rate limit key for the caller. IPv6 addresses are grouped by /64, because one host often owns a whole /64. */
function xc_client_key(): string
{
    $ip = (string) ($_SERVER['REMOTE_ADDR'] ?? '');
    $bin = @inet_pton($ip);
    if ($bin === false) {
        $bin = $ip;
    } elseif (strlen($bin) === 16) {
        $bin = substr($bin, 0, 8);
    }
    return substr(hash('sha256', 'xcnav-rl|' . $bin), 0, 32);
}

/** A rate from the config file, or the default. */
function xc_rate(string $configName, float $default): float
{
    $v = xc_config($configName);
    return (is_int($v) || is_float($v)) && $v > 0 ? (float) $v : $default;
}

/**
 * Take one token from a token bucket stored in the cache folder.
 * Returns 0 when a token was taken, or the seconds until one is available.
 * File errors allow the request, so a cache problem never locks every viewer out.
 */
function xc_take_token(string $name, float $capacity, float $perSecond): float
{
    $fh = @fopen(xc_cache_dir() . '/rl_' . $name . '.json', 'c+');
    if ($fh === false) {
        return 0.0;
    }
    try {
        if (!flock($fh, LOCK_EX)) {
            return 0.0;
        }
        $now = microtime(true);
        $data = json_decode((string) stream_get_contents($fh), true);
        $tokens = $capacity;
        if (is_array($data) && isset($data['t'], $data['at'])) {
            $tokens = min($capacity, (float) $data['t'] + max(0.0, $now - (float) $data['at']) * $perSecond);
        }
        $wait = 0.0;
        if ($tokens >= 1.0) {
            $tokens -= 1.0;
        } else {
            $wait = (1.0 - $tokens) / $perSecond;
        }
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, json_encode(['t' => round($tokens, 4), 'at' => round($now, 3)]));
        fflush($fh);
        return $wait;
    } finally {
        flock($fh, LOCK_UN);
        fclose($fh);
    }
}

/** Limit API requests per client. Sends 429 and stops when the client is over the limit. */
function xc_rate_limit_request(): void
{
    $perMin = xc_rate('XCNAV_RATE_PER_MIN', XC_RATE_PER_MIN);
    $wait = xc_take_token('req_' . xc_client_key(), $perMin, $perMin / 60);
    if ($wait > 0) {
        xc_too_many($wait);
    }
}

/**
 * Take one reflector fetch from this client's budget and from the site-wide budget.
 * Returns 0 when the fetch may go ahead, or the seconds to wait.
 */
function xc_reflector_budget(): float
{
    $client = xc_take_token(
        'refresh_' . xc_client_key(),
        XC_CLIENT_REFRESH_BURST,
        xc_rate('XCNAV_CLIENT_REFRESH_PER_MIN', XC_CLIENT_REFRESH_PER_MIN) / 60
    );
    if ($client > 0) {
        return $client;
    }
    return xc_take_token('reflector', XC_REFLECTOR_BURST, xc_rate('XCNAV_REFLECTOR_PER_MIN', XC_REFLECTOR_PER_MIN) / 60);
}

/** Path of the cached snapshot for a group. The id is already validated. */
function xc_group_cache_path(string $groupId): string
{
    // Hash the id so case-insensitive file systems never merge two groups.
    return xc_cache_dir() . '/group_' . substr(hash('sha256', $groupId), 0, 32) . '.json';
}

/** Delete old cache files now and then. */
function xc_maybe_cleanup(): void
{
    if (random_int(1, 100) > 2) {
        return;
    }
    $now = time();
    foreach (glob(xc_cache_dir() . '/*') ?: [] as $file) {
        $mtime = @filemtime($file);
        if ($mtime === false) {
            continue;
        }
        $base = basename($file);
        $maxAge = strpos($base, 'avatar_') === 0 ? 14 * 86400 : XC_MAX_AGE + 3600;
        if (strpos($base, 'rl_') === 0) {
            // A bucket untouched this long is full again, so deleting it changes nothing.
            $maxAge = 3600;
        }
        if (substr($base, -4) === '.tmp') {
            $maxAge = 600;
        }
        if ($now - $mtime > $maxAge) {
            @unlink($file);
        }
    }
}
