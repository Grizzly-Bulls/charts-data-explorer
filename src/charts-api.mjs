/** Small, source-faithful adapter for the published keyless Charts API. */
const CANONICAL_ORIGIN = 'https://grizzlybulls.com';
const MAX_BODY_BYTES = 1_500_000;
const API_TIMEOUT_MS = 8_000;
export const DEFAULT_QUERY = Object.freeze({ order: 'desc', limit: 100, offset: 0 });
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ApiError extends Error {
  constructor(message, status = 502) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

export const validDay = date => {
  if (!ISO_DAY.test(date)) return false;
  const ms = Date.parse(`${date}T00:00:00Z`);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date;
};
export const validSlug = slug => typeof slug === 'string' && slug.length <= 120 && SLUG.test(slug);

export function resolveApiOrigin(value = process.env.CHARTS_API_BASE_URL) {
  if (!value) return CANONICAL_ORIGIN;
  let url;
  try { url = new URL(value); } catch { throw new ApiError('Invalid upstream configuration.', 500); }
  const canonical = url.origin === CANONICAL_ORIGIN && url.protocol === 'https:';
  const loopback = url.protocol === 'http:'
    && url.hostname === '127.0.0.1'
    && url.port && url.port !== '0'
    && process.env.NODE_ENV !== 'production';
  if ((!canonical && !loopback) || url.username || url.password || url.search || url.hash
      || url.pathname !== '/' || url.origin !== value.replace(/\/$/, '')) {
    throw new ApiError('Upstream must be the canonical public API or an explicit development loopback.', 500);
  }
  return url.origin;
}

export function parseExplorerQuery(input) {
  const q = input instanceof URLSearchParams ? input : new URLSearchParams(input);
  for (const key of q.keys()) {
    if (!['from', 'to', 'order', 'limit', 'offset'].includes(key) || q.getAll(key).length !== 1) {
      throw new ApiError('Unsupported or repeated query parameter.', 400);
    }
  }
  const from = q.get('from') ?? undefined;
  const to = q.get('to') ?? undefined;
  if (from !== undefined && !validDay(from) || to !== undefined && !validDay(to)) {
    throw new ApiError('Dates must be real YYYY-MM-DD observation dates.', 400);
  }
  if (from && to && from > to) throw new ApiError('Start date must be on or before end date.', 400);
  const order = q.get('order') ?? DEFAULT_QUERY.order;
  if (order !== 'asc' && order !== 'desc') throw new ApiError('Invalid observation order.', 400);
  const integer = (name, fallback, max, min) => {
    const raw = q.get(name);
    if (raw === null) return fallback;
    if (!/^(0|[1-9]\d*)$/.test(raw)) throw new ApiError(`Invalid ${name}.`, 400);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) {
      throw new ApiError(`Invalid ${name}.`, 400);
    }
    return value;
  };
  return {
    from, to, order,
    limit: integer('limit', DEFAULT_QUERY.limit, 250, 1),
    offset: integer('offset', DEFAULT_QUERY.offset, 10_000, 0),
  };
}

export function observationPath(slug, query) {
  if (!validSlug(slug)) throw new ApiError('Invalid series slug.', 400);
  const q = new URLSearchParams();
  if (query.from) q.set('from', query.from);
  if (query.to) q.set('to', query.to);
  q.set('order', query.order);
  q.set('limit', String(query.limit));
  q.set('offset', String(query.offset));
  return `/api/v1/charts/series/${slug}/observations?${q}`;
}

async function boundedJsonResponse(url, fetchImpl) {
  let response;
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(API_TIMEOUT_MS),
    });
  } catch {
    throw new ApiError('Charts API could not be reached. Please retry later.', 502);
  }
  if (!response?.ok) {
    if (response?.status === 404) throw new ApiError('This approved data series is unavailable.', 404);
    if (response?.status === 429) throw new ApiError('The public API is rate-limiting requests. Please retry later.', 503);
    throw new ApiError('The Charts API is temporarily unavailable.', 502);
  }
  const type = response.headers?.get?.('content-type') || '';
  if (!type.toLowerCase().includes('application/json')) {
    throw new ApiError('The API returned an unexpected content type.');
  }
  if (!response.body) throw new ApiError('The API returned an empty body.');
  let bytes = 0;
  const chunks = [];
  try {
    for await (const chunk of response.body) {
      bytes += chunk.byteLength;
      if (bytes > MAX_BODY_BYTES) throw new ApiError('The API response exceeded the size limit.');
      chunks.push(Buffer.from(chunk));
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('The API returned an unreadable JSON response.');
  }
}

const object = x => !!x && typeof x === 'object' && !Array.isArray(x);
const safePublisherUrl = value => {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch { return false; }
};
const shapeSeries = x => object(x) && validSlug(x.slug)
  && typeof x.title === 'string' && x.title.length > 0
  && typeof x.unitLabel === 'string' && typeof x.frequency === 'string'
  && object(x.source) && typeof x.source.name === 'string'
  && safePublisherUrl(x.source.url)
  && object(x.freshness) && typeof x.freshness.state === 'string'
  && object(x.history) && Number.isSafeInteger(x.history.observationCount)
  && object(x.latestObservation) && validDay(x.latestObservation.date)
  && Number.isFinite(x.latestObservation.value);

export async function getCatalog({ fetchImpl = fetch, apiOrigin = resolveApiOrigin() } = {}) {
  const data = await boundedJsonResponse(`${apiOrigin}/api/v1/charts/series`, fetchImpl);
  if (!object(data) || !Array.isArray(data.series) || data.series.length > 1000
    || !data.series.every(shapeSeries)
    || new Set(data.series.map(s => s.slug)).size !== data.series.length) {
    throw new ApiError('The API catalog has an unexpected format.');
  }
  return data.series;
}

export async function getObservations(slug, query, { fetchImpl = fetch, apiOrigin = resolveApiOrigin() } = {}) {
  const data = await boundedJsonResponse(`${apiOrigin}${observationPath(slug, query)}`, fetchImpl);
  if (!object(data) || !shapeSeries(data.series) || data.series.slug !== slug
    || !Array.isArray(data.observations) || data.observations.length > query.limit
    || !data.observations.every(o => object(o) && validDay(o.date)
       && Number.isFinite(o.value) && typeof o.gapBefore === 'boolean')
    || !object(data.pagination) || data.pagination.offset !== query.offset
    || data.pagination.limit !== query.limit || data.pagination.order !== query.order
    || !Number.isSafeInteger(data.pagination.total)
    || ![null, undefined].includes(data.pagination.nextOffset)
      && (!Number.isSafeInteger(data.pagination.nextOffset) || data.pagination.nextOffset <= query.offset
        || data.pagination.nextOffset > query.offset + data.observations.length)) {
    throw new ApiError('The API returned observations with an unexpected format.');
  }
  for (let i = 1; i < data.observations.length; i++) {
    const previous = data.observations[i - 1].date;
    const current = data.observations[i].date;
    if (query.order === 'asc' ? current <= previous : current >= previous) {
      throw new ApiError('The API returned out-of-order observations.');
    }
  }
  return data;
}
