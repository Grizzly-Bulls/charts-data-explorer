import { observationPath } from './charts-api.mjs';

const ORIGIN = 'https://grizzlybulls.com';
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[char]);
const e = escapeHtml;
const fmt = n => Number(n).toLocaleString('en-US', { maximumFractionDigits: 6 });
const numWithUnit = (series, n) => series.unit === 'percent'
  ? `${fmt(n)}%`
  : series.unit === 'currency-billions' ? `$${fmt(n)}B`
    : `${fmt(n)} ${series.unitLabel}`;
const valueFormat = (series, value) => e(numWithUnit(series, value));
const short = (s, n = 350) => e(String(s ?? '').slice(0, n));

function shell({ title, summary, content, status = 200 }) {
  return {
    status,
    html: `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="description" content="${e(summary)}">
<title>${e(title)} · Charts Data Explorer</title><link rel="stylesheet" href="/styles.css"></head>
<body><div class="shell"><header class="site-header"><a class="brand" href="/" aria-label="Charts Data Explorer home"><span class="mark">GB</span><span>CHARTS <small>DATA EXPLORER</small></span></a><nav><a href="/">Browse series</a><a href="${ORIGIN}/charts/api" target="_blank" rel="noopener noreferrer">API docs</a><a href="${ORIGIN}/charts" target="_blank" rel="noopener noreferrer">Grizzly Bulls Charts</a></nav></header>
<main>${content}</main><footer class="footer"><span>Open-source reference integration of the public, keyless Economic Data API.</span><span>Historical source observations, not live market quotes. <a href="${ORIGIN}/charts/api">Data/API notes</a></span></footer></div><script src="/copy.js" defer></script></body></html>`,
  };
}

export function renderCatalog(series) {
  const categories = new Map();
  for (const item of series) {
    if (!categories.has(item.category)) categories.set(item.category, []);
    categories.get(item.category).push(item);
  }
  const sections = [...categories].map(([category, entries]) => `<section aria-label="${e(category)} series" class="collection">
    <div class="section-head"><h2>${e(category.replaceAll('-', ' '))}</h2><span>${entries.length} series</span></div>
    <div class="cards">${entries.map(s => `<article class="card"><div class="card-eyebrow">${e(s.frequency)} · ${e(s.source.name)}</div>
    <h3><a href="/series/${encodeURIComponent(s.slug)}">${e(s.title)}</a></h3><p>${short(s.description, 260)}</p>
    <div class="card-bottom"><strong>${valueFormat(s, s.latestObservation.value)}</strong>
    <span>${e(s.latestObservation.date)}</span></div></article>`).join('')}</div></section>`).join('');
  return shell({
    title: 'Explore approved economic series',
    summary: 'Explore source-backed historical datasets from the public Grizzly Bulls Economic Data API.',
    content: `<div class="hero"><div class="eyebrow">GRIZZLY BULLS · OPEN API EXPLORER</div><h1>Reliable economic data.<br><em>One request away.</em></h1>
    <p>Browse every series in the approved machine-readable catalog, inspect its history, and copy the exact request behind the visualization. No API key needed.</p>
    <div class="hero-actions"><a class="button primary" href="${ORIGIN}/charts/api">Read API documentation</a><a class="button" href="${ORIGIN}/api/v1/charts/series">View raw JSON catalog</a></div></div>
    <div class="status-bar"><span class="pulse"></span><strong>${series.length}</strong> live catalog ${series.length === 1 ? 'series' : 'series'}<span class="separator">•</span>Direct source-backed observations<span class="separator">•</span>Keyless public endpoints</div>
    ${sections || '<div class="empty">No API-eligible datasets are currently listed. Please check the official API catalog later.</div>'}`,
  });
}

const groupPoints = (rows, width = 870, height = 320) => {
  // Only plot real, already returned API values. X spacing is elapsed calendar time.
  const dates = rows.map(o => Date.parse(`${o.date}T00:00:00Z`));
  const values = rows.map(o => o.value);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || Math.max(Math.abs(high) * 0.1, 1);
  const ymin = low - span * 0.12;
  const ymax = high + span * 0.12;
  const left = 85; const right = 20; const top = 24; const bottom = 51;
  const x0 = Math.min(...dates); const x1 = Math.max(...dates);
  const x = d => left + (x1 === x0 ? (width - left - right) / 2 : (d - x0) / (x1 - x0) * (width - left - right));
  const y = v => top + (ymax - v) / (ymax - ymin) * (height - top - bottom);
  const segments = [];
  let segment = [];
  rows.forEach((row, i) => {
    // `gapBefore` describes the previous canonical chronological observation.
    if (i > 0 && row.gapBefore) {
      if (segment.length) segments.push(segment);
      segment = [];
    }
    segment.push([x(dates[i]), y(row.value)]);
  });
  if (segment.length) segments.push(segment);
  return { segments, values, dates, low, high, ymin, ymax, x, y, left, right, top, bottom, width, height };
};

export function buildSvg(series, inputRows) {
  if (!inputRows.length) return '<div class="empty">No observations match this date range.</div>';
  const rows = [...inputRows].sort((a, b) => a.date.localeCompare(b.date));
  const p = groupPoints(rows);
  const grid = Array.from({ length: 5 }, (_, i) => {
    const v = p.ymin + (p.ymax - p.ymin) * i / 4;
    const py = p.y(v);
    return `<line x1="${p.left}" x2="${p.width - p.right}" y1="${py.toFixed(2)}" y2="${py.toFixed(2)}" class="grid-line"/><text x="${p.left - 12}" y="${(py + 4).toFixed(2)}" text-anchor="end" class="axis-label">${e(fmt(v))}</text>`;
  }).join('');
  const lines = p.segments.map(seg => seg.length > 1
    ? `<polyline class="plot-line" points="${seg.map(([x, y]) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' ')}"/>`
    : '').join('');
  const dots = rows.map((row, i) => `<circle cx="${p.x(p.dates[i]).toFixed(2)}" cy="${p.y(row.value).toFixed(2)}" r="${rows.length > 110 ? 1.8 : 3.2}" class="plot-dot"><title>${e(row.date)}: ${valueFormat(series, row.value)}</title></circle>`).join('');
  const start = rows[0].date;
  const end = rows[rows.length - 1].date;
  return `<div class="plot-scroller"><svg viewBox="0 0 870 320" role="img" aria-label="${e(series.title)} chart. Source observations ${e(start)} to ${e(end)}; missing periods are not connected.">
  ${grid}<line x1="${p.left}" x2="850" y1="269" y2="269" class="axis-line"/>${lines}${dots}
  <text x="${p.left}" y="304" class="axis-label">${e(start)}</text><text x="850" y="304" text-anchor="end" class="axis-label">${e(end)}</text></svg></div>`;
}

const queryPath = (slug, query) => `/series/${encodeURIComponent(slug)}?${new URLSearchParams(Object.entries(query).filter(([, v]) => v !== undefined).map(([k, v]) => [k, String(v)]))}`;

export function renderSeries(data, query) {
  const { series, observations, pagination } = data;
  const rows = observations;
  const apiPath = observationPath(series.slug, query);
  const apiUrl = `${ORIGIN}${apiPath}`;
  const curl = `curl --fail-with-body -H 'Accept: application/json' '${apiUrl}'`;
  const prevLink = query.offset > 0
    ? queryPath(series.slug, { ...query, offset: Math.max(0, query.offset - query.limit) }) : null;
  const nextLink = pagination.nextOffset !== null && pagination.nextOffset !== undefined && pagination.nextOffset <= 10_000
    ? queryPath(series.slug, { ...query, offset: pagination.nextOffset }) : null;
  const gaps = observations.filter(x => x.gapBefore).length;
  const offsetCeiling = pagination.nextOffset !== null && pagination.nextOffset > 10_000;
  const meta = `<div class="fact-grid">
    <div><span>Frequency</span><strong>${e(series.frequency)}</strong></div>
    <div><span>Full retained history</span><strong>${series.history.observationCount.toLocaleString('en-US')} observations</strong><small>${e(series.history.firstObservationDate)} to ${e(series.history.lastObservationDate)}</small></div>
    <div><span>Latest observation</span><strong>${valueFormat(series, series.latestObservation.value)}</strong><small>${e(series.latestObservation.date)}</small></div>
    <div><span>Freshness status</span><strong>${e(series.freshness.state)}</strong><small>Assessed ${e(series.freshness.asOfDate)}</small></div>
  </div>`;
  const options = [25, 50, 100, 250].map(n => `<option value="${n}" ${query.limit === n ? 'selected' : ''}>${n}</option>`).join('');
  return shell({
    title: series.title,
    summary: series.description,
    content: `<div class="back"><a href="/">← All API series</a></div><div class="title-block"><div class="eyebrow">${e(series.category)} · ${e(series.source.name)}</div><h1>${e(series.title)}</h1><p>${short(series.description, 900)}</p><div class="source-link"><a href="${ORIGIN}/charts/${encodeURIComponent(series.slug)}">View canonical Grizzly Bulls chart ↗</a></div></div>
    ${meta}
    <section class="panel" aria-labelledby="history"><div class="section-head"><h2 id="history">Observation history</h2><span>Source periods, not release dates</span></div>
    <form method="get" action="/series/${encodeURIComponent(series.slug)}" class="filters">
      <label>From <input type="date" name="from" value="${e(query.from ?? '')}"></label>
      <label>To <input type="date" name="to" value="${e(query.to ?? '')}"></label>
      <label>Order <select name="order"><option value="desc" ${query.order === 'desc' ? 'selected' : ''}>Newest first</option><option value="asc" ${query.order === 'asc' ? 'selected' : ''}>Oldest first</option></select></label>
      <label>Page size <select name="limit">${options}</select></label><button class="button primary" type="submit">Apply</button>
    </form>
    ${buildSvg(series, observations)}
    <p class="note">The plot spaces observations by actual elapsed time. Missing source periods are not interpolated. 
    ${gaps > 0 ? `${gaps} returned observations indicate a gap before their canonical chronological position.` : 'No material source-period gaps are marked within this returned page.'}
    The plot uses this page of results, not the full series history.${offsetCeiling ? ' The public API limits offset pagination to 10,000 observations. Narrow your date range to continue.' : ''}</p></section>
    <div class="cols"><section class="panel" aria-labelledby="table"><div class="section-head"><h2 id="table">Exact observations</h2><span>${rows.length.toLocaleString('en-US')} of ${pagination.total.toLocaleString('en-US')} matching</span></div>
    <div class="table-wrap"><table><caption>API values and canonical missing-period flags</caption><thead><tr><th scope="col">Period</th><th scope="col">Value (${e(series.unitLabel)})</th><th scope="col">Gap before</th></tr></thead><tbody>${rows.map(row => `<tr><td>${e(row.date)}</td><td>${valueFormat(series, row.value)}</td><td>${row.gapBefore ? 'Yes' : 'No'}</td></tr>`).join('') || '<tr><td colspan="3">No observations found</td></tr>'}</tbody></table></div>
    <div class="pager">${prevLink ? `<a class="button" href="${e(prevLink)}">← Previous</a>` : '<span></span>'}<span>Offset ${query.offset.toLocaleString('en-US')}</span>${nextLink ? `<a class="button" href="${e(nextLink)}">Next →</a>` : '<span></span>'}</div></section>
    <section class="panel" aria-labelledby="api"><div class="section-head"><h2 id="api">Make this API request</h2><span>No API key required</span></div><p>Reproduce the exact data shown here. The URL and query use the public, approved Economic Data API.</p>
    <div class="code-wrap"><pre id="example-request"><code>${e(curl)}</code></pre><button class="button" type="button" data-copy="example-request">Copy</button></div>
    <div class="button-row"><a class="button" href="${e(apiUrl)}" target="_blank" rel="noopener noreferrer">View JSON ↗</a><a class="button" href="${ORIGIN}/api/v1/charts/openapi" target="_blank" rel="noopener noreferrer">OpenAPI schema ↗</a></div>
    <dl class="source-dl"><dt>Original publisher</dt><dd>${e(series.source.name)}</dd><dt>Dataset</dt><dd>${e(series.source.dataset)}</dd><dt>Source</dt><dd><a href="${e(series.source.url)}" target="_blank" rel="noopener noreferrer">Publisher source ↗</a></dd>
    <dt>Source retrieved</dt><dd>${e(series.source.accessDate || 'Not provided')}</dd><dt>Revisions</dt><dd>Latest-known retained history. Not a historical as-of vintage.</dd></dl>
    <p class="note">Pagination uses offsets, and pages may change after source revisions. 
    <code>gapBefore</code> is relative to the preceding canonical historical observation, not necessarily the prior row in descending results.</p></section></div>`,
  });
}

export function renderError(error, status = 502) {
  return shell({ title: 'Economic Data API unavailable', summary: 'The Economic Data API request could not be completed.', status,
    content: `<div class="hero error"><div class="eyebrow">DATA ACCESS</div><h1>Couldn't load this request.</h1><p>${e(error)}</p>
    <div class="hero-actions"><a class="button primary" href="/">Back to catalog</a><a class="button" href="${ORIGIN}/charts/api">API documentation</a></div></div>` });
}
