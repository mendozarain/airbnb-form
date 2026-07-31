#!/usr/bin/env python3

import importlib.util
import sys
import unittest
from datetime import date, timedelta
from pathlib import Path


MODULE_PATH = Path(__file__).with_name("hostex_dynamic_pricing.py")
SPEC = importlib.util.spec_from_file_location("hostex_dynamic_pricing", MODULE_PATH)
pricing = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
sys.modules[SPEC.name] = pricing
SPEC.loader.exec_module(pricing)


def config():
    return {
        "base_airbnb_price": 3000,
        "minimum_airbnb_price": 2500,
        "maximum_non_event_airbnb_price": 3700,
        "rainy_season_discount": 0.05,
        "urgent_gap_days": 14,
        "urgent_gap_discount": 0.17,
        "weekend_premium": 0.08,
        "low_occupancy_threshold": 0.3,
        "low_occupancy_discount": 0.05,
        "low_occupancy_lead_days": 45,
        "medium_occupancy_threshold": 0.65,
        "medium_occupancy_premium": 0.08,
        "high_occupancy_threshold": 0.8,
        "high_occupancy_premium": 0.15,
        "event_boost": 0.25,
        "round_to": 50,
        "recurring_events": [
            {"name": "Kadayawan Festival", "start": "08-15", "end": "08-24"}
        ],
    }


class PricingTests(unittest.TestCase):
    def test_urgent_gap_respects_2500_floor(self):
        today = date(2026, 7, 10)
        result = pricing.calculate_daily_price(today, today, True, 0.1, config())
        self.assertEqual(result.airbnb_price, 2500)
        self.assertIn("urgent gap", result.reasons)

    def test_non_event_price_respects_3700_ceiling(self):
        today = date(2026, 12, 1)
        saturday = today + timedelta(days=(5 - today.weekday()) % 7)
        result = pricing.calculate_daily_price(saturday, today, False, 1.0, config())
        self.assertLessEqual(result.airbnb_price, 3700)

    def test_event_boost_is_limited_to_configured_dates(self):
        today = date(2026, 7, 10)
        before = pricing.calculate_daily_price(date(2026, 8, 14), today, False, 0.5, config())
        during = pricing.calculate_daily_price(date(2026, 8, 15), today, False, 0.5, config())
        after = pricing.calculate_daily_price(date(2026, 8, 25), today, False, 0.5, config())
        self.assertIsNone(before.event)
        self.assertEqual(during.event, "Kadayawan Festival")
        self.assertEqual(during.airbnb_price, 3750)
        self.assertIsNone(after.event)

    def test_every_non_airbnb_channel_uses_150_percent_ratio(self):
        item = pricing.DailyPrice(date(2026, 7, 10), 2500, None, ("base",))
        ranges = pricing.compress_prices([item], 1.5)
        self.assertEqual(ranges[0]["price"], 3750)

    def test_equal_consecutive_prices_are_compressed(self):
        items = [
            pricing.DailyPrice(date(2026, 7, 10), 3000, None, ("base",)),
            pricing.DailyPrice(date(2026, 7, 11), 3000, None, ("base",)),
            pricing.DailyPrice(date(2026, 7, 12), 3200, None, ("base",)),
        ]
        ranges = pricing.compress_prices(items, 1.0)
        self.assertEqual(len(ranges), 2)
        self.assertEqual(ranges[0]["start_date"], "2026-07-10")
        self.assertEqual(ranges[0]["end_date"], "2026-07-11")


if __name__ == "__main__":
    unittest.main()
