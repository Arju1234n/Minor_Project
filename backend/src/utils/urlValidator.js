/**
 * URL Validator & SSRF Prevention Utility for CCTV / RTSP camera streams.
 */

const BLOCKED_HOSTS = new Set([
  '169.254.169.254',             // AWS / GCP / Azure Instance Metadata Service
  'metadata.google.internal',     // GCP Metadata hostname
  '169.254.169.250',             // Azure wire server
  'fd00:ec2::254',               // AWS IPv6 metadata
]);

const DANGEROUS_PORTS = new Set([
  27017, // MongoDB
  6379,  // Redis
  5432,  // PostgreSQL
  3306,  // MySQL
  9200,  // Elasticsearch
  11211, // Memcached
  2375,  // Docker daemon
  2376,  // Docker daemon TLS
]);

/**
 * Validate and parse a camera stream URL.
 * Supports RTSP, RTSPS, HTTP, and HTTPS streams.
 *
 * @param {string} rawUrl - Raw stream URL entered by user
 * @returns {{ isValid: boolean, error?: string, parsed?: { protocol: string, hostname: string, port: number, username?: string, password?: string, sanitizedUrl: string, fullUrl: string } }}
 */
function validateCameraUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== 'string') {
    return { isValid: false, error: 'Camera stream URL is required' };
  }

  const trimmed = rawUrl.trim();

  // Basic regex check for supported schemes
  const schemeMatch = trimmed.match(/^([a-zA-Z0-9+.-]+):\/\//);
  if (!schemeMatch) {
    return {
      isValid: false,
      error: 'Invalid stream URL format. Must start with rtsp://, rtsps://, http://, or https://',
    };
  }

  const scheme = schemeMatch[1].toLowerCase();
  const allowedSchemes = ['rtsp', 'rtsps', 'http', 'https'];
  if (!allowedSchemes.includes(scheme)) {
    return {
      isValid: false,
      error: `Unsupported streaming protocol: '${scheme}://'. Supported protocols are RTSP, RTSPS, HTTP, and HTTPS.`,
    };
  }

  try {
    // Note: Node's new URL() supports rtsp: and standard protocols
    const parsed = new URL(trimmed);
    const hostname = parsed.hostname.toLowerCase();
    const port = parsed.port ? parseInt(parsed.port, 10) : (scheme === 'rtsp' ? 554 : scheme === 'https' ? 443 : 80);

    // SSRF Check: Cloud Metadata Services
    if (BLOCKED_HOSTS.has(hostname) || hostname.endsWith('.metadata.google.internal')) {
      return {
        isValid: false,
        error: 'Security alert: Access to cloud metadata services is strictly prohibited.',
      };
    }

    // SSRF Check: Internal Database Ports
    if (DANGEROUS_PORTS.has(port)) {
      return {
        isValid: false,
        error: `Security alert: Access to port ${port} is restricted to prevent unauthorized service access.`,
      };
    }

    // Extract credentials if embedded in URL
    const username = parsed.username ? decodeURIComponent(parsed.username) : undefined;
    const password = parsed.password ? decodeURIComponent(parsed.password) : undefined;

    // Build sanitized URL with masked credentials using standard URL mutation
    let sanitizedUrl = trimmed;
    try {
      const safeParsed = new URL(trimmed);
      if (safeParsed.password) {
        safeParsed.password = '******';
        sanitizedUrl = safeParsed.toString();
      }
    } catch (_) {}

    return {
      isValid: true,
      parsed: {
        protocol: parsed.protocol.replace(':', ''),
        hostname,
        port,
        username,
        password,
        sanitizedUrl,
        fullUrl: trimmed,
        pathname: parsed.pathname,
      },
    };
  } catch (err) {
    return {
      isValid: false,
      error: `Malformed stream URL: ${err.message}`,
    };
  }
}

/**
 * Mask credentials in any URL or log string.
 * @param {string} url - URL that may contain username:password
 * @returns {string} Sanitized URL
 */
function maskUrlCredentials(url) {
  if (!url || typeof url !== 'string') return '';
  try {
    const u = new URL(url);
    if (u.password) {
      u.password = '******';
      return u.toString();
    }
  } catch (_) {}
  return url.replace(/:\/\/(.*?):(.*?)@/, '://$1:******@');
}

module.exports = {
  validateCameraUrl,
  maskUrlCredentials,
};
