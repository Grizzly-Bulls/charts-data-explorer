"""Synthetic, network-free regression checks for the optional FRED-shaped adapter."""

import importlib.util
import socket
import ssl
import urllib.error
from pathlib import Path
from unittest import TestCase, main
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("macro_dashboard_adapter", HERE / "macro_dashboard_adapter.py")
assert spec and spec.loader
adapter = importlib.util.module_from_spec(spec)
spec.loader.exec_module(adapter)


def payload(series_id, dates, values, *, flags=None):
    slug, unit, granularity, source = adapter.SERIES[series_id]
    return {
        "series": {
            "slug": slug, "unit": unit, "dateGranularity": granularity,
            "frequency": "Monthly" if granularity == "month" else "Quarterly",
            "source": {"name": source},
        },
        "observations": [
            {"date": d, "value": v, "gapBefore": bool((flags or [False] * len(dates))[i])}
            for i, (d, v) in enumerate(zip(dates, values))
        ],
        "pagination": {"order": "desc", "offset": 0, "limit": len(dates)},
    }


class TestReviewedMapping(TestCase):
    def test_unemployment_month_end_becomes_first_of_month_unchanged_units(self):
        data = payload("UNRATE", ["2026-09-30", "2026-08-31"], [4.3, 4.2])
        self.assertEqual(adapter.project_fred_observations("UNRATE", data, 2), [
            {"date": "2026-09-01", "value": 4.3},
            {"date": "2026-08-01", "value": 4.2},
        ])

    def test_payroll_count_converts_to_fred_thousands_and_keeps_order(self):
        data = payload("PAYEMS", ["2026-09-30", "2026-08-31", "2026-07-31"],
                       [157_200_000, 157_084_000, 157_112_000])
        result = adapter.project_fred_observations("PAYEMS", data, 3)
        self.assertEqual(result, [
            {"date": "2026-09-01", "value": 157200},
            {"date": "2026-08-01", "value": 157084},
            {"date": "2026-07-01", "value": 157112},
        ])
        # This synthetic month-over-month diff is in thousands, not jobs.
        self.assertEqual(result[0]["value"] - result[1]["value"], 116)

    def test_gdp_quarter_end_becomes_fred_quarter_start_no_reannualization(self):
        data = payload("A191RL1Q225SBEA", ["2026-09-30", "2026-06-30"], [2.5, -0.7])
        self.assertEqual(adapter.project_fred_observations("A191RL1Q225SBEA", data, 2), [
            {"date": "2026-07-01", "value": 2.5},
            {"date": "2026-04-01", "value": -0.7},
        ])

    def test_cpi_and_other_unreviewed_series_are_explicitly_excluded(self):
        for sid in ["CPIAUCSL", "CPILFESL", "ICSA", "FRED_FAKE", "PCEPI"]:
            with self.subTest(sid=sid), self.assertRaises(adapter.ChartsAdapterError):
                adapter.project_fred_observations(sid, {}, 14)

    def test_malformed_units_source_identity_and_page_rejected(self):
        data = payload("UNRATE", ["2026-09-30"], [4.3])
        data["series"]["unit"] = "count"
        with self.assertRaisesRegex(adapter.ChartsAdapterError, "identity or units"):
            adapter.project_fred_observations("UNRATE", data, 1)
        data["series"]["unit"] = "percent"
        data["series"]["source"]["name"] = "Unknown"
        with self.assertRaises(adapter.ChartsAdapterError):
            adapter.project_fred_observations("UNRATE", data, 1)
        data["series"]["source"]["name"] = "U.S. Bureau of Labor Statistics"
        data["pagination"]["order"] = "asc"
        with self.assertRaises(adapter.ChartsAdapterError):
            adapter.project_fred_observations("UNRATE", data, 1)

    def test_payroll_gap_fail_closed_instead_of_inventing_monthly_change(self):
        data = payload("PAYEMS", ["2026-09-30", "2026-07-31"], [150000000, 149000000])
        with self.assertRaisesRegex(adapter.ChartsAdapterError, "Missing payroll month"):
            adapter.project_fred_observations("PAYEMS", data, 2)
        data = payload("PAYEMS", ["2026-09-30", "2026-08-31"],
                       [150000000, 149000000], flags=[True, False])
        with self.assertRaisesRegex(adapter.ChartsAdapterError, "marks a gap"):
            adapter.project_fred_observations("PAYEMS", data, 2)

    def test_malformed_dates_duplicates_values_and_order_fail_closed(self):
        for dates, values in [
            (["2026-09-01"], [4.3]),
            (["2026-09-30", "2026-09-30"], [4.3, 4.2]),
            (["2026-08-31", "2026-09-30"], [4.2, 4.3]),
            (["2026-09-30"], [float("nan")]),
            (["2026-09-30"], [True]),
        ]:
            with self.subTest(dates=dates, values=values):
                data = payload("UNRATE", dates, values)
                with self.assertRaises(adapter.ChartsAdapterError):
                    adapter.project_fred_observations("UNRATE", data, len(dates))

    def test_limits_are_bounded_and_bool_not_accepted(self):
        for limit in (0, -1, 251, True, 1.2):
            with self.subTest(limit=limit), self.assertRaises(adapter.ChartsAdapterError):
                adapter.fetch_compatible_fred_series("UNRATE", limit)

    def test_fetch_uses_only_fixed_host_and_explicit_path(self):
        data = payload("UNRATE", ["2026-09-30"], [4.3])
        with patch.object(adapter, "_read_public_json", return_value=data) as read:
            output = adapter.fetch_compatible_fred_series("UNRATE", 1)
        self.assertEqual(output, [{"date": "2026-09-01", "value": 4.3}])
        self.assertEqual(read.call_args.args[0],
                         "https://grizzlybulls.com/api/v1/charts/series/unemployment-rate/observations?order=desc&limit=1&offset=0")

    def test_no_network_request_for_unsupported_series(self):
        with patch.object(adapter, "_read_public_json") as read:
            with self.assertRaises(adapter.ChartsAdapterError):
                adapter.fetch_compatible_fred_series("CPIAUCSL", 14)
            read.assert_not_called()

    def test_http_error_keeps_status_visible_and_identifies_client(self):
        request_url = "https://grizzlybulls.com/api/v1/charts/series"
        with patch.object(adapter.urllib.request, "build_opener") as build:
            build.return_value.open.side_effect = urllib.error.HTTPError(
                request_url, 403, "Forbidden", {}, None
            )
            with self.assertRaisesRegex(adapter.ChartsAdapterError, r"HTTP 403"):
                adapter._read_public_json(request_url)
            request = build.return_value.open.call_args.args[0]
            self.assertEqual(request.get_header("Accept"), "application/json")
            self.assertEqual(
                request.get_header("User-agent"),
                "GrizzlyBullsChartsExplorer-PythonExample/0.1"
            )
            self.assertEqual(build.return_value.open.call_args.kwargs["timeout"], 8)

    def test_dns_tls_and_timeout_are_distinguishable_without_leaking_details(self):
        cases = [
            (urllib.error.URLError(socket.gaierror(-3, "PRIVATE_DNS_DETAIL")), "DNS"),
            (urllib.error.URLError(ssl.SSLError("PRIVATE_TLS_DETAIL")), "TLS"),
            (urllib.error.URLError(TimeoutError("PRIVATE_TIMEOUT_DETAIL")), "timeout"),
        ]
        for exc, category in cases:
            with self.subTest(category=category):
                with patch.object(adapter.urllib.request, "build_opener") as build:
                    build.return_value.open.side_effect = exc
                    with self.assertRaisesRegex(
                        adapter.ChartsAdapterError, f"network error \\({category}\\)"
                    ) as caught:
                        adapter._read_public_json("https://grizzlybulls.com/api/v1/charts/series")
                    self.assertNotIn("PRIVATE_", str(caught.exception))

    def test_http_redirect_is_not_silently_followed(self):
        self.assertIsNone(
            adapter._NoRedirect().redirect_request(
                None, None, 302, "Redirect", {}, "https://example.org"
            )
        )


if __name__ == "__main__":
    main()
