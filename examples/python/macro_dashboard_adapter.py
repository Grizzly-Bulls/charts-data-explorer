"""Optional, standard-library-only Grizzly Bulls adapter for FRED-shaped dashboards.

This is a narrow *example*, not a FRED-compatible API or production SDK.
Only the three reviewed overlapping series are supported. Other FRED series,
including the seasonally adjusted CPIAUCSL, must continue using FRED.

Historical responses are latest-known observations, never release vintages.
The returned dates are normalized observation periods, not release dates.
"""

from __future__ import annotations

import calendar
import json
import math
import socket
import ssl
import urllib.error
import urllib.parse
import urllib.request
from datetime import date
from typing import Any


API_ORIGIN = "https://grizzlybulls.com"
MAX_RESPONSE_BYTES = 1_500_000
MAX_LIMIT = 250

# (reviewed Charts slug, exact public unit, granularity, source organization)
SERIES = {
    "UNRATE": (
        "unemployment-rate", "percent", "month", "U.S. Bureau of Labor Statistics"
    ),
    "PAYEMS": (
        "total-nonfarm-payroll-employment", "count", "month",
        "U.S. Bureau of Labor Statistics",
    ),
    "A191RL1Q225SBEA": (
        "us-real-gdp-growth", "percent", "quarter",
        "U.S. Bureau of Economic Analysis",
    ),
}


class ChartsAdapterError(ValueError):
    """Not safe to substitute the Charts response for the FRED series."""


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, request, fp, code, msg, headers, newurl):
        return None


def _read_public_json(url: str) -> Any:
    """A single bounded GET to the fixed public origin; no redirect or secrets."""
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            # Identify this example transparently instead of using urllib's
            # generic default user agent. Never impersonate a browser.
            "User-Agent": "GrizzlyBullsChartsExplorer-PythonExample/0.1",
        },
    )
    try:
        with urllib.request.build_opener(_NoRedirect).open(request, timeout=8) as response:
            if response.status != 200:
                raise ChartsAdapterError(f"Charts API returned HTTP {response.status}")
            if response.headers.get_content_type() != "application/json":
                raise ChartsAdapterError("Charts API returned non-JSON content")
            raw = response.read(MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as exc:
        # HTTPError inherits URLError; keep status visible to distinguish
        # a Cloudflare/WAF response from DNS, TLS, or a broken network.
        raise ChartsAdapterError(f"Charts API returned HTTP {exc.code}") from exc
    except urllib.error.URLError as exc:
        reason = exc.reason
        if isinstance(reason, socket.gaierror):
            category = "DNS"
        elif isinstance(reason, ssl.SSLError):
            category = "TLS"
        elif isinstance(reason, TimeoutError):
            category = "timeout"
        else:
            category = type(reason).__name__
        # No raw error strings: they may contain local proxy configuration.
        raise ChartsAdapterError(f"Charts API network error ({category})") from exc
    except TimeoutError as exc:
        raise ChartsAdapterError("Charts API network error (timeout)") from exc
    except OSError as exc:
        raise ChartsAdapterError(f"Charts API network error ({type(exc).__name__})") from exc
    if len(raw) > MAX_RESPONSE_BYTES:
        raise ChartsAdapterError("Charts API response exceeded byte limit")
    try:
        return json.loads(raw)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ChartsAdapterError("Charts API returned invalid JSON") from exc


def _period_start(iso: str, granularity: str) -> tuple[date, str]:
    if not isinstance(iso, str) or len(iso) != 10:
        raise ChartsAdapterError("Expected a source observation date")
    try:
        period_end = date.fromisoformat(iso)
    except ValueError as exc:
        raise ChartsAdapterError("Invalid source observation date") from exc
    if granularity == "month":
        if period_end.day != calendar.monthrange(period_end.year, period_end.month)[1]:
            raise ChartsAdapterError("Expected BLS calendar month-end observations")
        start = date(period_end.year, period_end.month, 1)
    elif granularity == "quarter":
        if period_end.month not in (3, 6, 9, 12) or period_end.day != calendar.monthrange(
            period_end.year, period_end.month
        )[1]:
            raise ChartsAdapterError("Expected BEA calendar quarter-end observations")
        start = date(period_end.year, period_end.month - 2, 1)
    else:
        raise ChartsAdapterError("Unexpected observation granularity")
    return start, start.isoformat()


def project_fred_observations(series_id: str, payload: Any, limit: int = 14) -> list[dict]:
    """Validate and map a Charts response to the date/value FRED fetcher shape.

    Values are kept in source units except PAYEMS, where public Charts values
    are in **jobs** and FRED PAYEMS uses **thousands of jobs**.
    """
    if series_id not in SERIES:
        raise ChartsAdapterError("No reviewed Charts mapping for FRED series")
    if type(limit) is not int or not 1 <= limit <= MAX_LIMIT:
        raise ChartsAdapterError("Limit must be an integer from 1 to 250")
    if not isinstance(payload, dict):
        raise ChartsAdapterError("Expected a Charts observations object")
    slug, unit, granularity, organization = SERIES[series_id]
    meta = payload.get("series")
    paging = payload.get("pagination")
    observations = payload.get("observations")
    if not isinstance(meta, dict) or not isinstance(paging, dict):
        raise ChartsAdapterError("Charts metadata or pagination is missing")
    if (meta.get("slug") != slug or meta.get("unit") != unit
        or meta.get("dateGranularity") != granularity
        or meta.get("frequency") != ("Monthly" if granularity == "month" else "Quarterly")
        or not isinstance(meta.get("source"), dict)
        or meta["source"].get("name") != organization):
        raise ChartsAdapterError("Charts series identity or units do not match the reviewed mapping")
    if (paging.get("order") != "desc" or paging.get("offset") != 0
        or paging.get("limit") != limit
        or not isinstance(observations, list)
        or not 1 <= len(observations) <= limit):
        raise ChartsAdapterError("Unexpected Charts page shape")

    results: list[dict] = []
    prior_start: date | None = None
    for item in observations:
        if not isinstance(item, dict):
            raise ChartsAdapterError("Invalid Charts observation")
        start, normalized = _period_start(item.get("date"), granularity)
        if prior_start is not None:
            if start >= prior_start:
                raise ChartsAdapterError("Charts observations are not strictly descending")
            # The existing dashboard derives month-over-month payroll changes
            # from adjacent observations. A missing period would make that false.
            if series_id == "PAYEMS":
                expected_month = (prior_start.year * 12 + prior_start.month - 2)
                if start.year * 12 + start.month - 1 != expected_month:
                    raise ChartsAdapterError("Missing payroll month; use FRED fallback")
        if series_id == "PAYEMS" and item.get("gapBefore") is True:
            raise ChartsAdapterError("Payroll source marks a gap; use FRED fallback")
        raw_value = item.get("value")
        if isinstance(raw_value, bool) or not isinstance(raw_value, (int, float)):
            raise ChartsAdapterError("Charts observation must contain a numeric value")
        if not math.isfinite(raw_value):
            raise ChartsAdapterError("Charts observation is not finite")
        value = raw_value / 1000 if series_id == "PAYEMS" else raw_value
        results.append({"date": normalized, "value": value})
        prior_start = start
    return results


def fetch_compatible_fred_series(series_id: str, limit: int = 14) -> list[dict]:
    """Fetch only explicitly supported series; raises for callers to use FRED fallback."""
    if series_id not in SERIES:
        raise ChartsAdapterError("No reviewed Charts mapping for FRED series")
    if type(limit) is not int or not 1 <= limit <= MAX_LIMIT:
        raise ChartsAdapterError("Limit must be an integer from 1 to 250")
    slug = SERIES[series_id][0]
    query = urllib.parse.urlencode({"order": "desc", "limit": limit, "offset": 0})
    url = f"{API_ORIGIN}/api/v1/charts/series/{slug}/observations?{query}"
    return project_fred_observations(series_id, _read_public_json(url), limit)


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Fetch one reviewed FRED-shaped Charts series")
    parser.add_argument("series", choices=sorted(SERIES))
    parser.add_argument("--limit", type=int, default=14)
    args = parser.parse_args()
    try:
        print(json.dumps(fetch_compatible_fred_series(args.series, args.limit), indent=2))
    except ChartsAdapterError as exc:
        parser.exit(1, f"Charts adapter unavailable: {exc}\n")
