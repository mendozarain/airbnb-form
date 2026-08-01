import type { PricingConfig } from "@cozy-d-714/shared";

export type PricingInputBooking = { checkIn: string; checkOut: string; status: string };
export type PricingAvailability = { date: string; available: boolean };
export type CalculatedPricingDay = {
  date: string;
  airbnbPrice: number;
  available: boolean;
  occupancyRatio: number;
  event: string | null;
  reasons: string[];
};

export function calculatePricing(
  today: string,
  config: PricingConfig,
  bookings: PricingInputBooking[],
  availabilities: PricingAvailability[]
) {
  const end = addDays(today, config.horizonDays);
  const dates = datesInRange(today, end);
  const available = new Map(availabilities.map((item) => [item.date, item.available]));
  const missing = dates.filter((date) => !available.has(date));
  if (missing.length) throw new Error(`Hostex availability is missing ${missing.length} date(s)`);

  const bookedDates = new Set<string>();
  for (const booking of bookings) {
    if (booking.status !== "accepted") continue;
    for (const date of datesInRange(
      maxDate(booking.checkIn, today),
      addDays(minDate(booking.checkOut, addDays(end, 1)), -1)
    )) {
      if (date >= today && date <= end) bookedDates.add(date);
    }
  }

  const occupancy = new Map<string, { booked: number; total: number; ratio: number }>();
  for (const date of dates) {
    const key = date.slice(0, 7);
    const current = occupancy.get(key) ?? { booked: 0, total: 0, ratio: 0 };
    current.total += 1;
    if (bookedDates.has(date)) current.booked += 1;
    occupancy.set(key, current);
  }
  for (const value of occupancy.values()) value.ratio = value.total ? value.booked / value.total : 0;

  const days = dates.map((date) => {
    const occupancyRatio = occupancy.get(date.slice(0, 7))?.ratio ?? 0;
    return calculateDay(date, today, available.get(date) ?? false, occupancyRatio, config);
  });
  return { end, occupancy: Object.fromEntries(occupancy), days };
}

export function calculateDay(
  date: string,
  today: string,
  available: boolean,
  occupancyRatio: number,
  config: PricingConfig
): CalculatedPricingDay {
  const day = new Date(`${date}T00:00:00.000Z`);
  const month = day.getUTCMonth() + 1;
  const leadDays = daysBetween(today, date);
  let price = config.baseAirbnbPrice;
  const reasons = ["base"];

  if (month >= 6 && month <= 11) {
    price *= 1 - config.rainySeasonDiscount;
    reasons.push("rainy season");
  }
  if (occupancyRatio >= config.highOccupancyThreshold) {
    price *= 1 + config.highOccupancyPremium;
    reasons.push("high occupancy");
  } else if (occupancyRatio >= config.mediumOccupancyThreshold) {
    price *= 1 + config.mediumOccupancyPremium;
    reasons.push("medium occupancy");
  } else if (occupancyRatio <= config.lowOccupancyThreshold && leadDays <= config.lowOccupancyLeadDays) {
    price *= 1 - config.lowOccupancyDiscount;
    reasons.push("low occupancy");
  }
  if ([5, 6].includes(day.getUTCDay())) {
    price *= 1 + config.weekendPremium;
    reasons.push("weekend");
  }
  if (available && leadDays <= config.urgentGapDays) {
    price *= 1 - config.urgentGapDiscount;
    reasons.push("urgent gap");
  }

  let airbnbPrice = clamp(
    roundTo(price, config.roundTo),
    config.minimumAirbnbPrice,
    config.maximumNonEventAirbnbPrice
  );
  const event = recurringEvent(date, config.recurringEvents);
  if (event) {
    airbnbPrice = Math.max(
      airbnbPrice,
      roundTo(config.baseAirbnbPrice * (1 + config.eventBoost), config.roundTo)
    );
    reasons.push(event);
  }
  return { date, airbnbPrice, available, occupancyRatio, event, reasons };
}

export function compressPrices(days: CalculatedPricingDay[], ratio: number) {
  const ranges: Array<{ start_date: string; end_date: string; price: number }> = [];
  for (const day of days) {
    const price = Math.round(day.airbnbPrice * ratio);
    const last = ranges.at(-1);
    if (last && last.price === price && addDays(last.end_date, 1) === day.date) last.end_date = day.date;
    else ranges.push({ start_date: day.date, end_date: day.date, price });
  }
  return ranges;
}

export function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function datesInRange(start: string, end: string) {
  if (end < start) return [];
  const values: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) values.push(cursor);
  return values;
}

function recurringEvent(date: string, events: PricingConfig["recurringEvents"]) {
  const year = Number(date.slice(0, 4));
  for (const event of events) {
    let start = `${year}-${event.start}`;
    let end = `${year}-${event.end}`;
    if (end < start) {
      end = `${year + 1}-${event.end}`;
      if (date < start) start = `${year - 1}-${event.start}`;
    }
    if (date >= start && date <= end) return event.name;
  }
  return null;
}

function daysBetween(first: string, second: string) {
  return Math.round((Date.parse(`${second}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
}

function roundTo(value: number, increment: number) {
  return Math.round(value / increment) * increment;
}

function clamp(value: number, minimum: number, maximum: number) {
  return Math.max(minimum, Math.min(maximum, value));
}

function minDate(first: string, second: string) {
  return first < second ? first : second;
}

function maxDate(first: string, second: string) {
  return first > second ? first : second;
}
