import { channelPrice, type PricingConfig, type PricingEvent } from "@cozy-d-714/shared";

export type PricingInputBooking = { checkIn: string; checkOut: string; status: string };
export type PricingAvailability = { date: string; available: boolean };
export type PricingRestrictionRange = {
  start_date: string;
  end_date: string;
  min_stay_on_arrival: number;
};
export type CalculatedPricingDay = {
  date: string;
  airbnbPrice: number;
  minStay: number;
  available: boolean;
  occupancyRatio: number;
  event: string | null;
  reasons: string[];
};

const WEEKEND_NIGHTS = new Set([5, 6]);

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

  const accepted = bookings.filter((booking) => booking.status === "accepted");
  const covers = (date: string) =>
    accepted.some((booking) => booking.checkIn <= date && date < booking.checkOut);

  const filled = (date: string): boolean | null => {
    if (covers(date)) return true;
    const listed = available.get(date);
    if (listed === undefined) return null;
    return !listed;
  };
  const forSale = (date: string) => filled(date) === false;

  const monthly = new Map<string, { booked: number; total: number; ratio: number }>();
  for (const date of dates) {
    const key = date.slice(0, 7);
    const current = monthly.get(key) ?? { booked: 0, total: 0, ratio: 0 };
    current.total += 1;
    if (filled(date)) current.booked += 1;
    monthly.set(key, current);
  }
  for (const value of monthly.values()) value.ratio = value.total ? value.booked / value.total : 0;

  const nearTermDates = datesInRange(today, addDays(today, config.paceHorizonDays)).filter((date) =>
    dates.includes(date)
  );
  const nearTermBooked = nearTermDates.filter((date) => filled(date) === true).length;
  const nearTermOccupancy = nearTermDates.length ? nearTermBooked / nearTermDates.length : 0;
  monthly.set("nearTerm", {
    booked: nearTermBooked,
    total: nearTermDates.length,
    ratio: nearTermOccupancy
  });

  const days = dates.map((date) => {
    const window = datesInRange(
      addDays(date, -config.paceWindowDays),
      addDays(date, config.paceWindowDays)
    ).filter((cursor) => filled(cursor) !== null);
    const windowBooked = window.filter((cursor) => filled(cursor) === true).length;
    const previous = filled(addDays(date, -1));
    const next = filled(addDays(date, 1));
    return calculateDay(
      date,
      today,
      {
        available: forSale(date),
        windowOccupancy: window.length ? windowBooked / window.length : 0,
        nearTermOccupancy,
        adjacentFilled: previous === true || next === true,
        orphanGap: forSale(date) && previous === true && next === true
      },
      config
    );
  });
  return { end, occupancy: Object.fromEntries(monthly), days };
}

export function calculateDay(
  date: string,
  today: string,
  context: {
    available: boolean;
    windowOccupancy: number;
    nearTermOccupancy: number;
    adjacentFilled: boolean;
    orphanGap: boolean;
  },
  config: PricingConfig
): CalculatedPricingDay {
  const leadDays = daysBetween(today, date);
  const weekend = isWeekendNight(date);
  const matching = eventsOn(date, config.events);
  const event = pricedEvent(matching);
  const reasons = [`${leadDays} days away`];
  let price = weekend ? config.weekendBasePrice : config.weekdayBasePrice;
  let floor = weekend ? config.weekendFloor : config.weekdayFloor;
  let cap = config.maximumPrice;

  if (event) {
    price = event.price;
    floor = event.minPrice ?? event.price;
    cap = Math.min(config.maximumPrice, event.maxPrice ?? event.price);
    reasons.push(event.name);
  } else {
    reasons.push(weekend ? "weekend" : "weekday");
  }

  const behindPace = context.nearTermOccupancy < config.lastMinutePaceThreshold;
  const lastMinute = context.available && leadDays <= config.lastMinuteLeadDays;
  const weekendHeldByNeighbors = weekend && context.adjacentFilled;
  const decay = lastMinute && behindPace && !event && !weekendHeldByNeighbors;

  if (decay) {
    price = weekend ? config.weekendFloor : config.lastMinuteWeekdayPrice;
    reasons.push(weekend ? "last-minute weekend floor" : "last-minute weekday");
  } else {
    if (cap > floor) price = occupancyPremium(price, context.windowOccupancy, config, reasons);
    if (!event && weekendHeldByNeighbors && config.weekendScarcityPremium > 0) {
      price *= 1 + config.weekendScarcityPremium;
      reasons.push("nearby dates booked");
    }
  }

  const airbnbPrice = clampMoney(price, floor, cap, config.roundTo);
  const minStay = minimumStay(date, leadDays, context, matching, config, reasons);
  if (!context.available) reasons.push("skipped: booked or blocked");
  return {
    date,
    airbnbPrice,
    minStay,
    available: context.available,
    occupancyRatio: context.windowOccupancy,
    event: event?.name ?? null,
    reasons
  };
}

export function compressPrices(days: CalculatedPricingDay[], ratio: number) {
  const ranges: Array<{ start_date: string; end_date: string; price: number }> = [];
  for (const day of days) {
    if (!day.available) continue;
    const price = channelPrice(day.airbnbPrice, ratio);
    const last = ranges.at(-1);
    if (last && last.price === price && addDays(last.end_date, 1) === day.date) last.end_date = day.date;
    else ranges.push({ start_date: day.date, end_date: day.date, price });
  }
  return ranges;
}

export function compressRestrictions(
  days: Array<Pick<CalculatedPricingDay, "date" | "available" | "minStay">>
) {
  const ranges: PricingRestrictionRange[] = [];
  for (const day of days) {
    if (!day.available) continue;
    const last = ranges.at(-1);
    if (last && last.min_stay_on_arrival === day.minStay && addDays(last.end_date, 1) === day.date) {
      last.end_date = day.date;
    } else {
      ranges.push({ start_date: day.date, end_date: day.date, min_stay_on_arrival: day.minStay });
    }
  }
  return ranges;
}

export function addDays(value: string, days: number) {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function minimumStay(
  date: string,
  leadDays: number,
  context: { available: boolean; orphanGap: boolean },
  matching: PricingEvent[],
  config: PricingConfig,
  reasons: string[]
) {
  const weekend = isWeekendNight(date);
  let stay = weekend ? config.weekendMinStay : config.defaultMinStay;
  let fromEvent = false;
  for (const event of matching) {
    if (event.minStay == null) continue;
    if (event.minStayOnWeekendsOnly && !weekend) continue;
    if (event.minStay >= stay) {
      stay = event.minStay;
      fromEvent = true;
    }
  }
  if (fromEvent) reasons.push("event minimum stay");
  else if (weekend) reasons.push("weekend minimum stay");
  else reasons.push("weekday minimum stay");

  if (
    context.available &&
    !fromEvent &&
    weekend &&
    leadDays <= config.minStayRelaxLeadDays &&
    stay > config.defaultMinStay
  ) {
    stay = config.defaultMinStay;
    reasons.push("relaxed close to arrival");
  }
  if (context.orphanGap && stay > config.defaultMinStay) {
    stay = config.defaultMinStay;
    reasons.push("orphan gap");
  }
  return stay;
}

function occupancyPremium(price: number, windowOccupancy: number, config: PricingConfig, reasons: string[]) {
  if (windowOccupancy >= config.highOccupancyThreshold && config.highOccupancyPremium > 0) {
    reasons.push("high surrounding occupancy");
    return price * (1 + config.highOccupancyPremium);
  }
  if (windowOccupancy >= config.mediumOccupancyThreshold && config.mediumOccupancyPremium > 0) {
    reasons.push("medium surrounding occupancy");
    return price * (1 + config.mediumOccupancyPremium);
  }
  return price;
}

function eventsOn(date: string, events: PricingEvent[]) {
  return events.filter((event) => {
    if (date < event.startDate || date > event.endDate) return false;
    if (event.weekendOnly && !isWeekendNight(date)) return false;
    return true;
  });
}

function pricedEvent(events: PricingEvent[]) {
  return events.reduce<PricingEvent | null>(
    (best, event) => (!best || event.price > best.price ? event : best),
    null
  );
}

function isWeekendNight(date: string) {
  return WEEKEND_NIGHTS.has(new Date(`${date}T00:00:00.000Z`).getUTCDay());
}

function datesInRange(start: string, end: string) {
  if (end < start) return [];
  const values: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) values.push(cursor);
  return values;
}

function daysBetween(first: string, second: string) {
  return Math.round((Date.parse(`${second}T00:00:00Z`) - Date.parse(`${first}T00:00:00Z`)) / 86_400_000);
}

function roundMoney(value: number, increment: number) {
  return Math.round(value / increment) * increment;
}

function clampMoney(value: number, floor: number, cap: number, increment: number) {
  return Math.min(cap, Math.max(floor, roundMoney(value, increment)));
}
