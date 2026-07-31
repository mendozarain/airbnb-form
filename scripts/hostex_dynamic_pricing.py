#!/usr/bin/env python3
"""Guarded daily dynamic pricing for D-714 through the Hostex v3 API.

Dry-run is the default. Passing --apply is required to submit prices.
Hostex price writes are asynchronous, so an accepted API response is reported
as a submission rather than as a completed OTA update.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CONFIG = ROOT / "scripts" / "hostex_pricing_config.json"
DEFAULT_ENV = ROOT / ".env.hostex"
API_BASE = "https://api.hostex.io/v3"
USER_AGENT = "cozy-d-714-pricing/1.0"


class PricingError(RuntimeError):
    pass


@dataclass(frozen=True)
class DailyPrice:
    day: date
    airbnb_price: int
    event: str | None
    reasons: tuple[str, ...]


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


def load_config(path: Path) -> dict[str, Any]:
    try:
        config = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PricingError(f"Cannot load pricing config {path}: {exc}") from exc

    required = {
        "property_id",
        "timezone",
        "horizon_days",
        "base_airbnb_price",
        "minimum_airbnb_price",
        "maximum_non_event_airbnb_price",
        "listings",
    }
    missing = sorted(required - config.keys())
    if missing:
        raise PricingError(f"Pricing config is missing: {', '.join(missing)}")

    minimum = int(config["minimum_airbnb_price"])
    maximum = int(config["maximum_non_event_airbnb_price"])
    base = int(config["base_airbnb_price"])
    if not minimum <= base <= maximum:
        raise PricingError("Airbnb minimum, base, and non-event maximum are inconsistent")

    listings = config["listings"]
    if not isinstance(listings, list) or not listings:
        raise PricingError("At least one Hostex listing is required")
    if not any(item.get("channel_type") == "airbnb" for item in listings):
        raise PricingError("An Airbnb listing is required as the reference channel")
    for item in listings:
        if float(item.get("ratio", 0)) <= 0:
            raise PricingError(f"Invalid price ratio for {item.get('listing_id', 'unknown listing')}")

    return config


class HostexClient:
    def __init__(self, token: str, timeout_seconds: int = 30) -> None:
        if not token or token == "replace-with-your-hostex-access-token":
            raise PricingError(
                "HOSTEX_ACCESS_TOKEN is missing. Copy .env.hostex.example to "
                ".env.hostex and add the token locally."
            )
        self.token = token
        self.timeout_seconds = timeout_seconds

    def request(
        self,
        method: str,
        path: str,
        *,
        query: dict[str, Any] | None = None,
        body: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        url = f"{API_BASE}{path}"
        if query:
            url = f"{url}?{urllib.parse.urlencode(query)}"
        data = None if body is None else json.dumps(body).encode("utf-8")
        headers = {
            "Accept": "application/json",
            "Hostex-Access-Token": self.token,
            "User-Agent": USER_AGENT,
        }
        if data is not None:
            headers["Content-Type"] = "application/json"
        request = urllib.request.Request(url, data=data, headers=headers, method=method)

        try:
            with urllib.request.urlopen(request, timeout=self.timeout_seconds) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")
            raise PricingError(f"Hostex HTTP {exc.code} for {path}: {detail[:500]}") from exc
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
            raise PricingError(f"Hostex request failed for {path}: {exc}") from exc

        error_code = payload.get("error_code")
        if error_code not in (None, 0, "0", 200, "200"):
            raise PricingError(
                f"Hostex error {error_code} for {path}: "
                f"{payload.get('error_msg', 'unknown error')}"
            )
        return payload

    def reservations(self, property_id: int, start: date, end: date) -> list[dict[str, Any]]:
        # Hostex requires both check-in bounds when filtering by check-in date.
        # A short lookback captures stays that began before today's pricing window.
        check_in_start = start - timedelta(days=30)
        reservations: list[dict[str, Any]] = []
        chunk_start = check_in_start
        while chunk_start <= end:
            # Hostex rejects check-in windows longer than 180 days. Keep each
            # inclusive window at 180 calendar days or fewer.
            chunk_end = min(chunk_start + timedelta(days=179), end)
            offset = 0
            while True:
                payload = self.request(
                    "GET",
                    "/reservations",
                    query={
                        "limit": 100,
                        "offset": offset,
                        "property_id": property_id,
                        "status": "accepted",
                        "start_check_in_date": chunk_start.isoformat(),
                        "end_check_in_date": chunk_end.isoformat(),
                    },
                )
                batch = payload.get("data", {}).get("reservations", [])
                reservations.extend(batch)
                if len(batch) < 100:
                    break
                offset += len(batch)
            chunk_start = chunk_end + timedelta(days=1)
        return reservations

    def availabilities(self, property_id: int, start: date, end: date) -> list[dict[str, Any]]:
        payload = self.request(
            "GET",
            "/availabilities",
            query={
                "property_ids": property_id,
                "start_date": start.isoformat(),
                "end_date": end.isoformat(),
            },
        )
        properties = payload.get("data", {}).get("properties", [])
        if not properties:
            raise PricingError("Hostex returned no availability data for the configured property")
        return properties[0].get("availabilities", [])

    def submit_prices(
        self, channel_type: str, listing_id: str, prices: list[dict[str, Any]]
    ) -> dict[str, Any]:
        return self.request(
            "POST",
            "/listings/prices",
            body={
                "channel_type": channel_type,
                "listing_id": listing_id,
                "prices": prices,
            },
        )


def month_key(day: date) -> str:
    return day.strftime("%Y-%m")


def dates_in_range(start: date, end: date):
    cursor = start
    while cursor <= end:
        yield cursor
        cursor += timedelta(days=1)


def occupancy_by_month(
    start: date, end: date, reservations: list[dict[str, Any]]
) -> tuple[dict[str, float], dict[str, tuple[int, int]]]:
    booked_dates: set[date] = set()
    for reservation in reservations:
        if reservation.get("status") != "accepted":
            continue
        try:
            check_in = date.fromisoformat(reservation["check_in_date"])
            check_out = date.fromisoformat(reservation["check_out_date"])
        except (KeyError, TypeError, ValueError):
            continue
        cursor = max(check_in, start)
        while cursor < min(check_out, end + timedelta(days=1)):
            booked_dates.add(cursor)
            cursor += timedelta(days=1)

    capacity: Counter[str] = Counter(month_key(day) for day in dates_in_range(start, end))
    booked: Counter[str] = Counter(month_key(day) for day in booked_dates if start <= day <= end)
    detail = {key: (booked[key], total) for key, total in sorted(capacity.items())}
    ratios = {key: nights / total if total else 0.0 for key, (nights, total) in detail.items()}
    return ratios, detail


def recurring_event_for_day(day: date, events: list[dict[str, str]]) -> str | None:
    for event in events:
        try:
            start_month, start_day = map(int, event["start"].split("-"))
            end_month, end_day = map(int, event["end"].split("-"))
            start = date(day.year, start_month, start_day)
            end = date(day.year, end_month, end_day)
        except (KeyError, TypeError, ValueError):
            continue
        if end < start:
            end = date(day.year + 1, end_month, end_day)
            if day < start:
                start = date(day.year - 1, start_month, start_day)
        if start <= day <= end:
            return event.get("name", "Configured event")
    return None


def round_price(value: float, increment: int) -> int:
    return int(round(value / increment) * increment)


def calculate_daily_price(
    day: date,
    today: date,
    available: bool,
    occupancy: float,
    config: dict[str, Any],
) -> DailyPrice:
    base = float(config["base_airbnb_price"])
    price = base
    reasons: list[str] = ["base"]
    lead_days = (day - today).days

    if 6 <= day.month <= 11:
        price *= 1 - float(config.get("rainy_season_discount", 0))
        reasons.append("rainy season")

    if occupancy >= float(config.get("high_occupancy_threshold", 1.1)):
        price *= 1 + float(config.get("high_occupancy_premium", 0))
        reasons.append("high occupancy")
    elif occupancy >= float(config.get("medium_occupancy_threshold", 1.1)):
        price *= 1 + float(config.get("medium_occupancy_premium", 0))
        reasons.append("medium occupancy")
    elif (
        occupancy <= float(config.get("low_occupancy_threshold", -1))
        and lead_days <= int(config.get("low_occupancy_lead_days", 0))
    ):
        price *= 1 - float(config.get("low_occupancy_discount", 0))
        reasons.append("low occupancy")

    if day.weekday() in (4, 5):
        price *= 1 + float(config.get("weekend_premium", 0))
        reasons.append("weekend")

    if available and lead_days <= int(config.get("urgent_gap_days", 0)):
        price *= 1 - float(config.get("urgent_gap_discount", 0))
        reasons.append("urgent gap")

    increment = int(config.get("round_to", 50))
    ordinary = round_price(price, increment)
    ordinary = max(int(config["minimum_airbnb_price"]), ordinary)
    ordinary = min(int(config["maximum_non_event_airbnb_price"]), ordinary)

    event = recurring_event_for_day(day, config.get("recurring_events", []))
    if event:
        event_price = round_price(
            base * (1 + float(config.get("event_boost", 0))), increment
        )
        ordinary = max(ordinary, event_price)
        reasons.append(event)

    return DailyPrice(day=day, airbnb_price=ordinary, event=event, reasons=tuple(reasons))


def compress_prices(
    daily_prices: list[DailyPrice], ratio: float
) -> list[dict[str, Any]]:
    if not daily_prices:
        return []

    def channel_price(item: DailyPrice) -> int:
        return int(round(item.airbnb_price * ratio))

    ranges: list[dict[str, Any]] = []
    start = daily_prices[0].day
    end = start
    current_price = channel_price(daily_prices[0])

    for item in daily_prices[1:]:
        item_price = channel_price(item)
        if item.day == end + timedelta(days=1) and item_price == current_price:
            end = item.day
            continue
        ranges.append(
            {"start_date": start.isoformat(), "end_date": end.isoformat(), "price": current_price}
        )
        start = end = item.day
        current_price = item_price

    ranges.append(
        {"start_date": start.isoformat(), "end_date": end.isoformat(), "price": current_price}
    )
    return ranges


def build_daily_prices(
    today: date,
    end: date,
    availabilities: list[dict[str, Any]],
    occupancy: dict[str, float],
    config: dict[str, Any],
) -> list[DailyPrice]:
    available_by_date = {
        item.get("date"): bool(item.get("available"))
        for item in availabilities
        if item.get("date")
    }
    missing = [day.isoformat() for day in dates_in_range(today, end) if day.isoformat() not in available_by_date]
    if missing:
        raise PricingError(
            f"Hostex availability data is missing {len(missing)} dates; refusing to price an incomplete horizon"
        )

    return [
        calculate_daily_price(
            day,
            today,
            available_by_date[day.isoformat()],
            occupancy.get(month_key(day), 0.0),
            config,
        )
        for day in dates_in_range(today, end)
    ]


def write_audit_log(
    mode: str,
    now: datetime,
    config: dict[str, Any],
    daily_prices: list[DailyPrice],
    submissions: list[dict[str, Any]],
) -> Path:
    log_dir = ROOT / ".local" / "hostex-pricing"
    log_dir.mkdir(parents=True, exist_ok=True)
    path = log_dir / f"{now.strftime('%Y%m%dT%H%M%S%z')}-{mode}.json"
    payload = {
        "mode": mode,
        "generated_at": now.isoformat(),
        "property_id": config["property_id"],
        "daily_airbnb_prices": [
            {
                "date": item.day.isoformat(),
                "price": item.airbnb_price,
                "event": item.event,
                "reasons": list(item.reasons),
            }
            for item in daily_prices
        ],
        "submissions": submissions,
    }
    path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    return path


def print_report(
    mode: str,
    now: datetime,
    config: dict[str, Any],
    occupancy_detail: dict[str, tuple[int, int]],
    daily_prices: list[DailyPrice],
    submissions: list[dict[str, Any]],
    audit_path: Path,
) -> None:
    price_counts = Counter(item.airbnb_price for item in daily_prices)
    urgent_count = sum("urgent gap" in item.reasons for item in daily_prices)
    event_dates = [item for item in daily_prices if item.event]

    print("===== HOSTEX DYNAMIC PRICING =====")
    print(f"Mode: {mode.upper()}")
    print(f"Property: {config.get('property_name', config['property_id'])}")
    print(f"Generated: {now.isoformat()}")
    print(f"Horizon: {daily_prices[0].day} to {daily_prices[-1].day}")
    print(
        "Guardrails: Airbnb PHP "
        f"{config['minimum_airbnb_price']}-{config['maximum_non_event_airbnb_price']} "
        "outside events; non-Airbnb channels 1.5x"
    )
    print("\nOccupancy:")
    for month, (booked, total) in occupancy_detail.items():
        percent = round((booked / total) * 100) if total else 0
        print(f"- {month}: {booked}/{total} nights ({percent}%)")
    print("\nAirbnb price distribution:")
    for price, count in sorted(price_counts.items()):
        print(f"- PHP {price}: {count} nights")
    print(f"- Urgent-gap dates: {urgent_count}")
    if event_dates:
        print("\nConfigured event dates:")
        grouped_events: dict[str, list[date]] = defaultdict(list)
        for item in event_dates:
            grouped_events[item.event or "Event"].append(item.day)
        for name, days in grouped_events.items():
            print(f"- {name}: {days[0]} to {days[-1]} at PHP {event_dates[0].airbnb_price}")

    print("\nNext 14 days:")
    for item in daily_prices[:14]:
        print(f"- {item.day}: PHP {item.airbnb_price} ({', '.join(item.reasons[1:]) or 'base'})")

    if mode == "apply":
        print("\nHostex submissions:")
        for submission in submissions:
            print(
                f"- ACCEPTED: {submission['channel_type']}/{submission['listing_id']} "
                f"({submission['range_count']} ranges, request {submission.get('request_id', 'not returned')})"
            )
        print("Hostex processes these jobs asynchronously; OTA completion must be checked in Sync Manager.")
    else:
        print("\nNo prices were submitted. Re-run with --apply to write to Hostex.")
    print(f"Audit log: {audit_path}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Submit calculated prices to Hostex")
    parser.add_argument("--config", type=Path, default=DEFAULT_CONFIG)
    parser.add_argument("--env-file", type=Path, default=DEFAULT_ENV)
    parser.add_argument(
        "--as-of",
        type=date.fromisoformat,
        help="Override today's date for deterministic testing (YYYY-MM-DD)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_env_file(args.env_file)
    config = load_config(args.config)
    timezone = ZoneInfo(config["timezone"])
    now = datetime.now(timezone)
    today = args.as_of or now.date()
    end = today + timedelta(days=int(config["horizon_days"]))

    client = HostexClient(os.environ.get("HOSTEX_ACCESS_TOKEN", ""))
    reservations = client.reservations(int(config["property_id"]), today, end)
    availabilities = client.availabilities(int(config["property_id"]), today, end)
    occupancy, occupancy_detail = occupancy_by_month(today, end, reservations)
    daily_prices = build_daily_prices(today, end, availabilities, occupancy, config)

    submissions: list[dict[str, Any]] = []
    if args.apply:
        failures: list[str] = []
        for listing in config["listings"]:
            ranges = compress_prices(daily_prices, float(listing["ratio"]))
            try:
                result = client.submit_prices(
                    listing["channel_type"], str(listing["listing_id"]), ranges
                )
                submissions.append(
                    {
                        "channel_type": listing["channel_type"],
                        "listing_id": str(listing["listing_id"]),
                        "ratio": float(listing["ratio"]),
                        "range_count": len(ranges),
                        "request_id": result.get("request_id"),
                    }
                )
            except PricingError as exc:
                failures.append(f"{listing['channel_type']}/{listing['listing_id']}: {exc}")
        if failures:
            raise PricingError(
                f"{len(failures)} Hostex price submissions failed after "
                f"{len(submissions)} were accepted:\n- " + "\n- ".join(failures)
            )

    mode = "apply" if args.apply else "dry-run"
    audit_path = write_audit_log(mode, now, config, daily_prices, submissions)
    print_report(mode, now, config, occupancy_detail, daily_prices, submissions, audit_path)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except PricingError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
