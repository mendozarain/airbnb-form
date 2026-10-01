import { PRICING_ALGORITHM, pricingConfigSchema } from "@cozy-d-714/shared";

export function upgradePricingConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid pricing settings");
  const legacy = value as Record<string, unknown>;
  if (legacy.algorithm !== undefined && legacy.algorithm !== PRICING_ALGORITHM) {
    throw new Error("Unsupported pricing algorithm");
  }
  if (legacy.algorithm === PRICING_ALGORITHM) return pricingConfigSchema.parse(legacy);
  const listings = Array.isArray(legacy.listings)
    ? legacy.listings.map((item: Record<string, unknown>) => ({
        ...item,
        ratio: ["agoda", "booking.com"].includes(String(item.channelType).toLowerCase()) ? 1.3 : item.ratio
      }))
    : legacy.listings;
  return pricingConfigSchema.parse({ ...legacy, algorithm: PRICING_ALGORITHM, listings });
}
