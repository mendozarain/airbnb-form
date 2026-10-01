// Shared by the engine and the settings table so displayed prices use the same rounding.
export const PRICING_TIERS = [
  { minimumDays: 31, label: "31+ days", fraction: 1 },
  { minimumDays: 15, label: "15–30 days", fraction: 0.75 },
  { minimumDays: 8, label: "8–14 days", fraction: 0.5 },
  { minimumDays: 3, label: "3–7 days", fraction: 0.25 },
  { minimumDays: 0, label: "0–2 days", fraction: 0 }
] as const;

export function pricingTier(leadDays: number) {
  return PRICING_TIERS.find((tier) => leadDays >= tier.minimumDays) ?? PRICING_TIERS[4];
}

export function tierPrice(startingPrice: number, minimum: number, leadDays: number, roundTo: number) {
  const tier = pricingTier(leadDays);
  if (tier.fraction === 0 || startingPrice <= minimum) return minimum;
  const raw = minimum + (startingPrice - minimum) * tier.fraction;
  // A narrow base/floor gap must not round to the floor before the final tier.
  return Math.min(startingPrice, Math.max(minimum + 1, Math.round(raw / roundTo) * roundTo));
}

export function channelPrice(airbnbPrice: number, ratio: number) {
  return Math.round(airbnbPrice * ratio);
}

export function startingPrice(price: number, minimum: number, maximum: number, roundTo: number) {
  const lowerBound = price > minimum ? minimum + 1 : minimum;
  return Math.min(maximum, Math.max(lowerBound, Math.round(price / roundTo) * roundTo));
}
