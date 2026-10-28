# Optional Python adapter for FRED-shaped macro dashboards

This is a small **standard-library-only** reference for Python dashboards such as [SunFish98/MacroDashboard](https://github.com/SunFish98/MacroDashboard). It does not change that project, replace FRED, or claim FRED-compatible endpoint semantics.

The Grizzly Bulls [Economic Data API](https://grizzlybulls.com/economic-data-api) is keyless, and its public observations are **latest-known**, not historical point-in-time release vintages. Observation dates are the periods measured, **not** release timestamps. The code uses only the approved Grizzly Bulls public API, with a fixed HTTPS origin, bounded responses and an 8-second timeout.

## Tested overlap

| Existing FRED ID | Grizzly Bulls slug | Conversion | Caveat |
| --- | --- | --- | --- |
| `UNRATE` | `unemployment-rate` | Calendar month-end → month-start; rate remains percent | U.S. seasonally adjusted unemployment rate; no claim of exact value parity across update cycles |
| `PAYEMS` | `total-nonfarm-payroll-employment` | Month-end → month-start; divide public *jobs* by 1,000 to recover FRED *thousands of jobs* | Source gaps or missing months are rejected rather than used for a false MoM calculation |
| `A191RL1Q225SBEA` | `us-real-gdp-growth` | Quarter-end → first day of quarter; growth percent unchanged | BEA quarter-over-quarter annualized rate, **not** the four-quarter YoY series |

**Intentionally excluded:** `CPIAUCSL`. The dashboard uses **seasonally adjusted** CPI, whereas the Charts API's `consumer-price-index` is **not seasonally adjusted** (`CUUR0000SA0`). It is not a valid substitute. All other FRED series, including core CPI, PCE, spreads, housing, PMI and retail sales, also remain on FRED.

This is an example of *safe optional substitution*, not a claim that historical revisions, revisions timing, provider observation counts, or downstream indicators will be exactly identical.

## Try it

Requires Python **3.10+**. No packages or API key needed for this optional example:

```bash
# Run entirely offline with synthetic data; makes no network calls.
python3 -m unittest discover -s examples/python -p 'test_*.py' -v

# Optional live read-only call, with no FRED key and no local writes.
python3 examples/python/macro_dashboard_adapter.py UNRATE --limit 3
```

The module returns descending observations in the same basic shape used by MacroDashboard's `FREDFetcher.fetch_series`:

```python
[{"date": "YYYY-MM-01", "value": 0.0}, ...]
```

This is a **shape illustration with a placeholder value**, not a real economic observation.

## Live read troubleshooting

The optional live command runs from the machine where you start the example; it does **not** use the NUC loopback path. Passing offline tests, or seeing an HTTP 200 on the NUC itself, does not prove that a public client can reach the same API through DNS, TLS and Cloudflare.

The CLI reports bounded error categories:
- `Charts API returned HTTP 403` (or another status): an HTTP rejection from the public path, potentially including an edge/WAF rule; do not bypass it with fake browser headers or silently switch to an unreviewed data source.
- `Charts API network error (DNS)`, `(TLS)`, or `(timeout)`: check local host resolution, certificate trust, clock, proxy/network reachability or latency.
- `Charts series identity or units do not match`: do not relax the contract to force conversion.

To compare the exact public endpoint's HTTP status with curl, **without printing data bodies**:

```bash
URL='https://grizzlybulls.com/api/v1/charts/series/unemployment-rate/observations?order=desc&limit=3&offset=0'
curl -sS --max-time 20 -o /dev/null \
  -w 'HTTP %{http_code} / remote IP %{remote_ip} / content-type %{content_type} / total %{time_total}s\n' \
  -H 'Accept: application/json' "$URL"
```

An HTTP success with curl but failure with Python points to a **client or edge treatment difference**; an identical rejection or network error points to a more general public-path issue. The Python example identifies itself transparently with a dedicated User-Agent. No external integration should be claimed until both the schema and live conversions are verified.

## Example opt-in integration (not applied upstream)

For a MacroDashboard-style project, keep the existing `FREDFetcher` as the authoritative fallback. Place `macro_dashboard_adapter.py` on the Python import path (for instance, alongside `data_fetchers.py`) and call the following function **instead of** its current `fred.fetch_series(series_id, limit=limit)` inside the macro refresh loop:

```python
from macro_dashboard_adapter import (
    ChartsAdapterError,
    SERIES,
    fetch_compatible_fred_series,
)


def optional_charts_observations(fred, series_id, limit=14):
    if series_id not in SERIES:
        return fred.fetch_series(series_id, limit=limit)
    try:
        return fetch_compatible_fred_series(series_id, limit=limit)
    except ChartsAdapterError:
        return fred.fetch_series(series_id, limit=limit)
```

The existing dashboard must still use its own `_build_indicator` to compute display modes; **do not** compute an additional percent change for BEA's already annualized GDP growth, or multiply PAYEMS jobs twice. This opt-in substitution deliberately leaves all other FRED sources and the rest of the dashboard untouched. If the Charts request, source identity, units, or period validation fails, the original FRED path remains the fallback. Missing FRED credentials still need to be handled by the dashboard in the usual way.

No integration, endorsement, upstream PR, or external adoption is implied. If a maintainer wishes to use the example, confirm live value parity for the overlapping observation periods before enabling it in production.
