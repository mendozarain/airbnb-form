import {
  pricingConfigSchema,
  type PricingConfig,
  type PricingEvent,
  type PricingListing
} from "./pricing-schema.js";

// Rain's defaults for D-714. Every figure is a setting; the engine does not hard-code these.
export const DEMAND_PRICING_DEFAULTS = {
  roundTo: 50,
  weekdayBasePrice: 2750,
  weekendBasePrice: 3400,
  weekdayFloor: 2300,
  weekendFloor: 3000,
  maximumPrice: 5000,
  lastMinuteLeadDays: 3,
  lastMinuteWeekdayPrice: 2300,
  lastMinutePaceThreshold: 0.6,
  paceHorizonDays: 14,
  paceWindowDays: 7,
  mediumOccupancyThreshold: 0.65,
  mediumOccupancyPremium: 0.06,
  highOccupancyThreshold: 0.8,
  highOccupancyPremium: 0.1,
  weekendScarcityPremium: 0.08,
  defaultMinStay: 1,
  weekendMinStay: 2,
  minStayRelaxLeadDays: 3,
  weeklyDiscountPercent: 10,
  monthlyDiscountPercent: 25,
  extraGuestFee: 250,
  includedGuests: 4
} as const;

function flat(
  event: Omit<PricingEvent, "minPrice" | "maxPrice"> & { minPrice?: number; maxPrice?: number }
): PricingEvent {
  return { ...event, minPrice: event.minPrice ?? event.price, maxPrice: event.maxPrice ?? event.price };
}

// Dated on purpose: Philippine holidays move. 2027 dates follow Proclamation No. 1427
// (8 September 2026). Eid'l Fitr and Eid'l Adha are omitted until a later proclamation
// dates them. EDSA (25 February 2027) is a special working day and is not priced as a holiday.
export const PRICING_EVENTS: PricingEvent[] = [
  flat({ name: "Undas", startDate: "2026-10-30", endDate: "2026-11-02", price: 3500 }),
  flat({ name: "Pasko Fiesta", startDate: "2026-11-28", endDate: "2026-11-30", price: 3400 }),
  flat({ name: "Immaculate Conception", startDate: "2026-12-08", endDate: "2026-12-08", price: 3400 }),
  flat({
    name: "Pasko / Christmas–New Year",
    startDate: "2026-12-19",
    endDate: "2027-01-02",
    price: 4200,
    minStay: 3
  }),
  flat({ name: "Pasko peak", startDate: "2026-12-24", endDate: "2026-12-25", price: 4800, minStay: 3 }),
  flat({ name: "Pasko peak", startDate: "2026-12-30", endDate: "2026-12-31", price: 4800, minStay: 3 }),
  flat({ name: "Chinese New Year", startDate: "2027-02-06", endDate: "2027-02-06", price: 3500 }),
  flat({
    name: "Araw ng Dabaw",
    startDate: "2027-03-12",
    endDate: "2027-03-21",
    price: 3500,
    weekendOnly: true
  }),
  flat({ name: "Holy Week", startDate: "2027-03-24", endDate: "2027-03-28", price: 4000, minStay: 2 }),
  flat({ name: "Araw ng Kagitingan", startDate: "2027-04-09", endDate: "2027-04-11", price: 3500 }),
  flat({ name: "Labor Day", startDate: "2027-05-01", endDate: "2027-05-02", price: 3400 }),
  flat({ name: "Independence Day", startDate: "2027-06-12", endDate: "2027-06-13", price: 3400 }),
  flat({
    name: "Kadayawan",
    startDate: "2027-08-07",
    endDate: "2027-08-24",
    price: 3500,
    minStay: 2,
    minStayOnWeekendsOnly: true
  }),
  flat({ name: "National Heroes Day", startDate: "2027-08-28", endDate: "2027-08-30", price: 3500 }),
  flat({ name: "Undas", startDate: "2027-10-30", endDate: "2027-11-02", price: 3500 }),
  flat({ name: "Bonifacio Day", startDate: "2027-11-30", endDate: "2027-11-30", price: 3400 }),
  flat({ name: "Immaculate Conception", startDate: "2027-12-08", endDate: "2027-12-08", price: 3400 }),
  flat({
    name: "Pasko / Christmas–New Year",
    startDate: "2027-12-19",
    endDate: "2028-01-02",
    price: 4200,
    minStay: 3
  }),
  flat({ name: "Pasko peak", startDate: "2027-12-24", endDate: "2027-12-25", price: 4800, minStay: 3 }),
  flat({ name: "Pasko peak", startDate: "2027-12-30", endDate: "2027-12-31", price: 4800, minStay: 3 })
];

export function pricingConfigWithDefaults(
  overrides: Partial<PricingConfig> & Pick<PricingConfig, "listings">
): PricingConfig {
  return pricingConfigSchema.parse({
    algorithm: "demand-pace-v1",
    propertyName: "D-714 Mantina Enclaves, Davao City",
    propertyId: 12684960,
    timezone: "Asia/Manila",
    horizonDays: 365,
    ...DEMAND_PRICING_DEFAULTS,
    events: PRICING_EVENTS,
    ...overrides
  });
}

export const DEFAULT_CHANNEL_RATIOS: Record<string, number> = {
  airbnb: 1,
  "booking.com": 1.2,
  agoda: 1.2,
  booking_site: 1
};

export function defaultListingRatio(channelType: string, current: unknown) {
  const channel = channelType.toLowerCase();
  if (channel in DEFAULT_CHANNEL_RATIOS) return DEFAULT_CHANNEL_RATIOS[channel];
  const ratio = Number(current);
  return Number.isFinite(ratio) && ratio > 0 ? ratio : 1;
}

export function listingsWithDefaultRatios(listings: PricingListing[]) {
  return listings.map((listing) => ({
    ...listing,
    ratio: defaultListingRatio(listing.channelType, listing.ratio)
  }));
}
