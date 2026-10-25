import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ApiError, getCatalog, getObservations, parseExplorerQuery, validSlug } from './charts-api.mjs';
import { renderCatalog, renderSeries, renderError } from './render.mjs';

const cssPath = fileURLToPath(new URL('./styles.css', import.meta.url));
const scriptPath = fileURLToPath(new URL('./copy.js', import.meta.url));
const MAX_PER_CLIENT_PER_MINUTE = 30;
const MAX_GLOBAL_PER_MINUTE = 180;

export function makeLimiter(now = () => Date.now()) {
  const clients = new Map();
  let globalWindow = 0;
  let globalCount = 0;
  return ip => {
    const timestamp = now();
    if (timestamp - globalWindow >= 60_000) {
      globalWindow = timestamp;
      globalCount = 0;
      clients.clear();
    }
    const current = clients.get(ip) ?? { since: timestamp, count: 0 };
    if (timestamp - current.since >= 60_000) { current.since = timestamp; current.count = 0; }
    // Bound attacker-controlled cardinality rather than growing a permanent IP map.
    if (globalCount >= MAX_GLOBAL_PER_MINUTE || current.count >= MAX_PER_CLIENT_PER_MINUTE
      || (!clients.has(ip) && clients.size >= MAX_GLOBAL_PER_MINUTE)) {
      return false;
    }
    current.count += 1;
    globalCount += 1;
    clients.set(ip, current);
    return true;
  };
}

const securityHeaders = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Content-Security-Policy': "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'none'; img-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'",
};

function reply(res, status, body, contentType = 'text/html; charset=utf-8', extra = {}) {
  res.writeHead(status, { ...securityHeaders, 'Content-Type': contentType, ...extra });
  res.end(body);
}

export function createApp({ catalog = getCatalog, observations = getObservations,
    limit = makeLimiter() } = {}) {
  return http.createServer(async (req, res) => {
    if (req.method !== 'GET') {
      return reply(res, 405, 'Method not allowed.', 'text/plain; charset=utf-8', { Allow: 'GET' });
    }
    let url;
    try { url = new URL(req.url, 'http://localhost'); }
    catch { return reply(res, 400, 'Invalid request URL.', 'text/plain; charset=utf-8'); }
    if (url.pathname === '/health') {
      return reply(res, 200, JSON.stringify({ status: 'ok', apiMode: 'keyless-public' }), 'application/json; charset=utf-8');
    }
    if (url.pathname === '/robots.txt') {
      return reply(res, 200, 'User-agent: *\nDisallow: /\n', 'text/plain; charset=utf-8');
    }
    if (url.pathname === '/styles.css' || url.pathname === '/copy.js') {
      try {
        const file = await readFile(url.pathname === '/styles.css' ? cssPath : scriptPath);
        return reply(res, 200, file, url.pathname === '/styles.css'
          ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8');
      } catch {
        return reply(res, 500, 'Asset unavailable.', 'text/plain; charset=utf-8');
      }
    }
    // Use only the socket peer, not untrusted X-Forwarded-For / CF-Connecting-IP.
    if (!limit(req.socket.remoteAddress || 'unknown')) {
      return reply(res, 429, 'Too many requests to this demo. Please retry in one minute.',
        'text/plain; charset=utf-8', { 'Retry-After': '60' });
    }
    try {
      if (url.pathname === '/') {
        if ([...url.searchParams].length) throw new ApiError('Unknown catalog query.', 400);
        const data = await catalog();
        const page = renderCatalog(data);
        return reply(res, page.status, page.html);
      }
      const match = /^\/series\/([a-z0-9-]+)$/.exec(url.pathname);
      if (!match || !validSlug(match[1])) throw new ApiError('Page not found.', 404);
      const query = parseExplorerQuery(url.searchParams);
      const approved = await catalog();
      if (!approved.some(s => s.slug === match[1])) {
        throw new ApiError('Series not available in the public API catalog.', 404);
      }
      const data = await observations(match[1], query);
      const page = renderSeries(data, query);
      return reply(res, page.status, page.html);
    } catch (error) {
      const status = error instanceof ApiError ? error.status : 502;
      const message = error instanceof ApiError ? error.message : 'Unexpected API response.';
      const page = renderError(message, status);
      return reply(res, page.status, page.html);
    }
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === fileURLToPath(new URL(`file://${process.argv[1]}`))) {
  const host = process.env.HOST ?? '127.0.0.1';
  const port = Number(process.env.PORT ?? '3000');
  if (!['127.0.0.1', '0.0.0.0', '::1'].includes(host)
    || !Number.isSafeInteger(port) || port < 1 || port > 65535) {
    process.stderr.write('Invalid HOST/PORT. Default is loopback 127.0.0.1:3000.\n');
    process.exitCode = 2;
  } else {
    const server = createApp();
    server.headersTimeout = 10_000;
    server.requestTimeout = 10_000;
    server.listen(port, host, () => process.stdout.write(`Charts Data Explorer listening on ${host}:${port}\n`));
  }
}
