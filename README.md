# Grizzly Bulls Charts Data Explorer

A small, open-source reference application for the [Grizzly Bulls public Charts API](https://grizzlybulls.com/charts/api).

It turns the **reviewed machine-readable economic-data catalog** into a browsable, source-backed historical chart, observation table, and copyable API request. It does not reproduce Grizzly Bulls' data acquisition, source normalization, revision pipeline, or rights decisions.

Unlike the separately authenticated developer pilot, the currently published public Charts endpoints demonstrated here are **keyless**. No sign-up or API key is needed to run this example. No paid Charts self-service plan is claimed to be available.

## Quickstart (about a minute)

Requirements: Node.js **24.x**, plus a running public Charts API at `grizzlybulls.com`.

```bash
git clone https://github.com/Grizzly-Bulls/charts-data-explorer.git
cd charts-data-explorer
npm start
```

Open [http://127.0.0.1:3000](http://127.0.0.1:3000). There are **no dependencies to install**. The application uses Node's built-in HTTP server and `fetch`.

> The source repository is public and ready to clone. There is no separately hosted Charts Data Explorer yet; run this application locally to try the keyless public API.

## What the explorer demonstrates

- Reads `GET /api/v1/charts/series` to discover only **currently API-approved** datasets. The supported catalog is dynamic; it is not a second manually maintained list of chart slugs.
- Reads `GET /api/v1/charts/series/{slug}/observations` for bounded historical data, with inclusive `from` and `to` observation dates, `asc`/`desc` ordering, limit (1–250), and offset (0–10,000).
- Renders a server-side SVG with **calendar-spaced** observations, no invented interpolation and visible breaks at `gapBefore` periods.
- Shows an accessible historical table of the exact returned observations, source/freshness metadata, and a direct link to the [canonical Charts page](https://grizzlybulls.com/charts).
- Makes the **exact keyless HTTP request** used for the current view easy to copy or open as JSON. Supports Next/Previous when source pagination allows it.
- Preserves errors: a source/API outage, malformed response or unknown series does not become an empty-but-fake chart.
- Includes source-shaped offline tests for date semantics, rights-safe catalog discovery, pagination, missing periods, XSS-resistant rendering, query bounds, and HTTP behavior.

## Call the API without this explorer

```bash
# Which data series are approved for machine-readable access?
curl --fail-with-body -H 'Accept: application/json' \
  'https://grizzlybulls.com/api/v1/charts/series'

# Example: the 20 most recent source observations of real GDP
curl --fail-with-body -H 'Accept: application/json' \
  'https://grizzlybulls.com/api/v1/charts/series/us-real-gdp/observations?order=desc&limit=20&offset=0'
```

The public contract and [OpenAPI description](https://grizzlybulls.com/api/v1/charts/openapi) are authoritative if this example becomes stale. This project does not guarantee that every chart visible on Grizzly Bulls can be accessed through the machine API. Display rights and data redistribution rights are reviewed separately.

### Response outline

An observations response contains:

- `series`: reviewed series metadata (title, source, units, frequency, complete retained-history boundaries, freshness and revision semantics);
- `observations`: dated numeric values and `gapBefore` flags;
- `pagination`: `total`, `limit`, `offset`, `nextOffset`, `order`, `from`, and `to`.

The `date` field identifies the **period measured**, which may not be the date the source published or later revised it. Historical values represent **latest-known retained history**, not what an analyst would have known at each earlier date. `gapBefore` refers to the previous **chronological canonical** observation, not necessarily the preceding returned record in descending order or after filters.

Pagination is not a frozen snapshot of the source data. Data can change after revisions; use source timestamps, re-fetch when appropriate, and never assume adjacent pages share one immutable vintage.

## Architecture and security

```text
browser GET / or /series/us-real-gdp?limit=100
          |
          v
local Node.js server (SSR HTML + SVG, bounded requests)
          |
          | GET /api/v1/charts/series
          | GET /api/v1/charts/series/{slug}/observations
          v
https://grizzlybulls.com (public, keyless API)
```

- The browser never needs a machine API key, and this demo does **not** expose a generic proxy route.
- Requests use a fixed canonical HTTPS origin. For local integration tests only, `CHARTS_API_BASE_URL=http://127.0.0.1:PORT` is allowed when `NODE_ENV` is not `production`. Arbitrary remote hosts are rejected.
- Upstream requests use an 8-second timeout, redirect rejection, an approximately 1.5 MB JSON cap, and schema/observation validation. All inputs are bounded before being forwarded.
- Rendered upstream text is escaped, and publisher URLs must be HTTPS. CSP and noindex headers protect the public demo surface and reduce competition with canonical Grizzly Bulls chart URLs.
- A conservative in-process limiter allows up to 30 user requests per socket peer per minute and 180 requests globally per minute. The limiter is **not** a distributed quota or a paid entitlement system. The API owner retains authority for upstream usage constraints.
- The application binds to loopback by default and should be placed behind a separately configured reverse proxy if hosted. A proxy funnels visitors through one socket peer; operators should design their own IP normalization, abuse protection and centralized limits before inviting significant public traffic.
- `/health` reports **only this example server's readiness**. It does not assert upstream API availability.

## Developer workflow

```bash
npm run check              # Syntax + all offline tests
npm run smoke:live         # Operator-only, read-only real API smoke (requires network)
npm run dev                # Node watch mode (local changes)
PORT=3001 npm start        # Alternate local port
```

No live Grizzly Bulls API traffic is generated by the offline tests. Test fixtures are explicitly synthetic.

## Scope boundaries

This demo is not a second financial research engine, a bulk export tool, an endpoint for unapproved source families, an API key/paid billing demo, a point-in-time vintage reconstruction service, or a real-time market-data product. There is no local database, provider scraper, cron job, dependency installation, or private Grizzly Bulls source dependency.

The project is licensed under [MIT](LICENSE). Source data remains subject to the upstream [Charts API's source/rights contract](https://grizzlybulls.com/charts/api) and the original providers' rights; the code license does not grant broader data redistribution permission.

For questions, bug reports or contributions, see [CONTRIBUTING.md](CONTRIBUTING.md).
