# Charts Data Explorer contributor guidance

This repository is an independent, small reference application for the public Grizzly Bulls Charts API.

## Core product boundary
- Treat the published `https://grizzlybulls.com/api/v1/charts/` endpoints as the only source of historical observations, metadata, freshness, rights and revision semantics.
- Do not import private Grizzly Bulls code, scrape official publishers, replicate the data pipeline, retain a shadow database, or fabricate/massage missing observations.
- Public approved Charts endpoints are keyless. Do not add a required API key, client-secret storage, browser tokens, or auth proxy just to run this example.
- Display and machine-readable redistribution rights are distinct. Query only the API catalog and its approved series, never guess eligibility from the public chart catalog.
- Respect API paging bounds, errors, timeouts and partial/unavailable state. Historical data is latest-known and not point-in-time vintage history.
- The `gapBefore` flag applies to the previous *canonical chronological observation*, not necessarily the previous returned row. Preserve gaps when charting an ascending page.
- Do not interpolate missing observations or claim observation dates are release dates.
- Keep URLs fixed to the public API origin or explicit loopback for offline testing. Do not build a generic URL proxy. No redirects and no private-network credentials.

## Public copy and operations
- Be clear, factual and concise. No internal phase identifiers or fabricated examples presented as source values.
- The demo must not compete with canonical search URLs: retain `noindex` and link back to the original chart pages and API documentation.
- Preserve browser accessibility, mobile layout, source provenance and full tabular access alongside the plot.
- Server-side rendering is intentional: no CORS assumption, API keys, frameworks, SDKs, runtime DB or deployment secrets. Prefer Node built-ins unless a measured requirement justifies a dependency.
- Validate changes with `npm run check`; tests use synthetic source-shaped fixtures only and never the live production endpoint.
