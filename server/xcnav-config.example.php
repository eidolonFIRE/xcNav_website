<?php
/**
 * xcNav spectator API secrets.
 *
 * Copy this file to the server OUTSIDE the web root:
 *     /home/<user>/secrets/xcnav-config.php
 * then set permissions:
 *     chmod 700 /home/<user>/secrets && chmod 600 /home/<user>/secrets/xcnav-config.php
 *
 * The API finds it at dirname(DOCUMENT_ROOT)/secrets/xcnav-config.php.
 * To use another path, set the XCNAV_CONFIG environment variable (e.g. SetEnv in .htaccess).
 *
 * Never commit the real file. Never put it inside the web root.
 */

// Reflector spectator token. On the EC2 host it is in /home/ubuntu/group_api_token.
const GROUP_API_TOKEN = 'replace-me';

// Optional: pilot avatars. Same values as profileStoreUrl / profileStoreToken in the app's
// lib/secrets.dart. URL format is "<host>/<stage>/<name>" with no scheme.
// Leave empty to show initials instead of avatars.
const PROFILE_STORE_URL = '';
const PROFILE_STORE_TOKEN = '';

// Optional: cache folder, outside the web root. Default: /home/<user>/xcnav-cache
// const XCNAV_CACHE_DIR = '/home/<user>/xcnav-cache';

// Optional: rate limits, per minute. A client is one IP address, or one /64 network for IPv6.
// const XCNAV_RATE_PER_MIN = 60;            // API requests per client
// const XCNAV_CLIENT_REFRESH_PER_MIN = 10;  // reflector fetches one client may cause
// const XCNAV_REFLECTOR_PER_MIN = 120;      // reflector fetches for the whole site
