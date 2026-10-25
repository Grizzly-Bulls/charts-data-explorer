import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseExplorerQuery, observationPath, validDay, validSlug, resolveApiOrigin,
  getCatalog, getObservations, ApiError,
} from '../src/charts-api.mjs';
import { buildSvg, renderCatalog, renderSeries, escapeHtml } from '../src/render.mjs';
import { createApp, makeLimiter } from '../src/server.mjs';

const series = {
  slug: 'us-real-gdp', title: 'Synthetic Real GDP', description: 'Synthetic observations for offline tests.',
  category: 'growth', unit: 'currency-billions', unitLabel: 'Billions of chained dollars',
  frequency: 'Quarterly', dateGranularity: 'quarter',
  history: { firstObservationDate: '2024-03-31', lastObservationDate: '2025-03-31', observationCount: 4 },
  latestObservation: { date: '2025-03-31', value: 126 },
  freshness: { state: 'fresh', asOfDate: '2025-04-30' },
  source: { name: 'Synthetic source', dataset: 'Test GDP', url: 'https://www.bea.gov', accessDate: '2025-04-30' },
};
const obs = [
  { date: '2025-03-31', value: 126, gapBefore: false },
  { date: '2024-12-31', value: 122, gapBefore: true },
  { date: '2024-06-30', value: 113, gapBefore: false },
  { date: '2024-03-31', value: 109, gapBefore: false },
];
const query = { order: 'desc', limit: 25, offset: 0 };
const payload = {
  series, observations: obs, pagination: {
    total: 4, limit: 25, offset: 0, nextOffset: null,
    order: 'desc', from: null, to: null,
  },
};
const response = (data, status = 200, headers = { 'Content-Type': 'application/json' }) => new Response(JSON.stringify(data), { status, headers });
const fetched = r => async (_url, options) => { assert.equal(options.redirect, 'error'); assert.equal(options.headers.Accept, 'application/json'); assert.equal(options.method, 'GET'); assert.equal(options.cache, 'no-store'); assert.equal(options.headers.Authorization, undefined); return r; };

test('URL builder validates exact approved public query semantics', () => {
  assert.equal(parseExplorerQuery(new URLSearchParams()).order, 'desc');
  assert.equal(observationPath(series.slug, query), '/api/v1/charts/series/us-real-gdp/observations?order=desc&limit=25&offset=0');
  assert.equal(validSlug('us-real-gdp'), true);
  assert.equal(validSlug('../api/secret'), false);
  assert.equal(validDay('2024-02-29'), true);
  assert.equal(validDay('2025-02-29'), false);
  const parsed = parseExplorerQuery(new URLSearchParams('from=2024-01-01&to=2025-01-01&order=asc&limit=250&offset=500'));
  assert.deepEqual(parsed, { from: '2024-01-01', to: '2025-01-01', order: 'asc', limit: 250, offset: 500 });
  for (const str of ['limit=251', 'offset=10001', 'limit=-1', 'order=random', 'from=2026-02-30', 'from=2026-10-01&to=2026-09-01', 'limit=20&limit=10', 'slug=us-real-gdp', 'raw=true']) {
    assert.throws(() => parseExplorerQuery(new URLSearchParams(str)), error => error instanceof ApiError && error.status === 400);
  }
});

test('upstream origin is pinned to canonical HTTPS or test-only explicit loopback', () => {
  assert.equal(resolveApiOrigin('https://grizzlybulls.com'), 'https://grizzlybulls.com');
  for (const input of ['https://example.com', 'https://grizzlybulls.com.evil.test', 'http://grizzlybulls.com', 'http://169.254.169.254', 'https://grizzlybulls.com@evil.test', 'http://localhost:8183', 'file:///etc/passwd']) {
    assert.throws(() => resolveApiOrigin(input), ApiError);
  }
  const former = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = 'development';
    assert.equal(resolveApiOrigin('http://127.0.0.1:8183'), 'http://127.0.0.1:8183');
    process.env.NODE_ENV = 'production';
    assert.throws(() => resolveApiOrigin('http://127.0.0.1:8183'), ApiError);
  } finally { if (former === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = former; }
});

test('catalog and observations consume only source-shaped public JSON', async () => {
  const catalog = await getCatalog({ fetchImpl: fetched(response({ series: [series] })), apiOrigin: 'http://127.0.0.1:8183' });
  assert.equal(catalog[0].slug, 'us-real-gdp');
  const get = async (url, opts) => {
    assert.equal(new URL(url).pathname, '/api/v1/charts/series/us-real-gdp/observations');
    return fetched(response(payload))(url, opts);
  };
  const result = await getObservations(series.slug, query, { fetchImpl: get, apiOrigin: 'http://127.0.0.1:8183' });
  assert.deepEqual(result.observations, obs);
  assert.equal(result.pagination.nextOffset, null);
});

test('API errors, missing fields, duplicate slug, out-of-order data and fake values fail closed', async () => {
  const o = { apiOrigin: 'http://127.0.0.1:8183' };
  await assert.rejects(getCatalog({ ...o, fetchImpl: fetched(response({ series: [series, series] })) }), ApiError);
  await assert.rejects(getCatalog({ ...o, fetchImpl: fetched(response({ series: [{ ...series, latestObservation: { date: '2025-03-31', value: 'NaN' } }] })) }), ApiError);
  await assert.rejects(getCatalog({ ...o, fetchImpl: fetched(response({}, 503)) }), ApiError);
  await assert.rejects(getCatalog({ ...o, fetchImpl: fetched(response({ series: [{ ...series, source: { ...series.source, url: 'javascript:alert(1)' } }] })) }), ApiError);
  await assert.rejects(getObservations(series.slug, query, { ...o, fetchImpl: fetched(response({ ...payload, observations: [{ ...obs[0], value: null }] })) }), ApiError);
  await assert.rejects(getObservations(series.slug, query, { ...o, fetchImpl: fetched(response({ ...payload, observations: [obs[1], obs[0]] })) }), ApiError);
  await assert.rejects(getObservations(series.slug, query, { ...o, fetchImpl: fetched(response({ ...payload, series: { ...series, slug: 'fake' } })) }), ApiError);
  const big = new Response(JSON.stringify({ oversized: 'x'.repeat(1_600_000) }), { headers: { 'Content-Type': 'application/json' } });
  await assert.rejects(getCatalog({ ...o, fetchImpl: fetched(big) }), /size limit/);
});

test('chart uses source dates, leaves gaps unconnected, and prints real values only', () => {
  const svg = buildSvg(series, obs);
  assert.match(svg, /<svg/);
  assert.match(svg, /2024-03-31/);
  assert.match(svg, /2025-03-31/);
  // Gap before 2024-12-31 divides the four-point chart into two line segments.
  assert.equal((svg.match(/<polyline/g) || []).length, 2);
  assert.equal((svg.match(/<circle/g) || []).length, obs.length);
  const empty = buildSvg(series, []);
  assert.match(empty, /No observations match/);
  assert.doesNotMatch(empty, /polyline/);
});

test('SSR escapes untrusted API metadata; API code and canonical links are exact and noindex', () => {
  assert.equal(escapeHtml('<script>\'"&'), '&lt;script&gt;&#39;&quot;&amp;');
  const injection = { ...series, title: '<img src=x onerror=alert(1)>' };
  const p = renderSeries({ ...payload, series: injection }, query).html;
  assert.doesNotMatch(p, /<img src=x onerror/);
  assert.match(p, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(p, /robots" content="noindex,nofollow/);
  assert.match(p, /\/charts\/us-real-gdp/);
  assert.match(p, /api\/v1\/charts\/series\/us-real-gdp\/observations\?order=desc&amp;limit=25&amp;offset=0/);
  assert.match(p, /No API key required/);
  assert.doesNotMatch(p, /Authorization: Bearer/);
  assert.match(renderCatalog([series]).html, /Synthetic Real GDP/);
});

test('per-client and global limiter avoid unbounded public upstream traffic', () => {
  let ms = 100_000;
  const limit = makeLimiter(() => ms);
  for (let i = 0; i < 30; i++) assert.equal(limit('127.0.0.1'), true);
  assert.equal(limit('127.0.0.1'), false);
  assert.equal(limit('127.0.0.2'), true);
  ms += 61_000;
  assert.equal(limit('127.0.0.1'), true);
});

test('HTTP integration renders catalog and detail using only injected synthetic data; protected routes absent', async () => {
  let calls = 0;
  const srv = createApp({
    catalog: async () => { calls++; return [series]; },
    observations: async (_slug, q) => {
      assert.equal(q.limit, 25);
      return payload;
    },
    limit: () => true,
  });
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const root = await fetch(base);
    assert.equal(root.status, 200);
    assert.match(await root.text(), /Synthetic Real GDP/);
    assert.equal(root.headers.get('x-robots-tag'), 'noindex, nofollow');
    const detail = await fetch(`${base}/series/us-real-gdp?limit=25&order=desc&offset=0`);
    assert.equal(detail.status, 200);
    assert.match(await detail.text(), /Make this API request/);
    const unknown = await fetch(`${base}/series/secret`);
    assert.equal(unknown.status, 404);
    const bad = await fetch(`${base}/series/us-real-gdp?limit=9999`);
    assert.equal(bad.status, 400);
    const noProxy = await fetch(`${base}/api/v1/developer/charts/series`);
    assert.equal(noProxy.status, 404);
    assert.equal(calls, 3);
  } finally {
    await new Promise((resolve, reject) => srv.close(e => e ? reject(e) : resolve()));
  }
});
