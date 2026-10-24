import {
  PRICING_ALGORITHM,
  listingsWithDefaultRatios,
  pricingConfigSchema,
  pricingConfigWithDefaults
} from "@cozy-d-714/shared";

const UPGRADABLE_ALGORITHMS = new Set(["vacancy-tiers-v1"]);
const DEFAULT_PROPERTY_NAME = "D-714 Mantina Enclaves, Davao City";

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function readNumber(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function upgradePricingConfig(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid pricing settings");
  const legacy = value as Record<string, unknown>;
  if (legacy.algorithm === PRICING_ALGORITHM) return pricingConfigSchema.parse(legacy);
  const algorithm = readString(legacy.algorithm);
  if (algorithm !== undefined && !UPGRADABLE_ALGORITHMS.has(algorithm)) {
    throw new Error("Unsupported pricing algorithm");
  }
  const listings = Array.isArray(legacy.listings)
    ? listingsWithDefaultRatios(
        legacy.listings.flatMap((item) => {
          if (!item || typeof item !== "object" || Array.isArray(item)) return [];
          const listing = item as Record<string, unknown>;
          return [
            {
              channelType: readString(listing.channelType) ?? "",
              listingId: readString(listing.listingId) ?? "",
              ratio: readNumber(listing.ratio, 1)
            }
          ];
        })
      )
    : [];
  const propertyName = readString(legacy.propertyName)?.trim();
  return pricingConfigWithDefaults({
    propertyName: propertyName || DEFAULT_PROPERTY_NAME,
    propertyId: readNumber(legacy.propertyId, 12684960),
    horizonDays: readNumber(legacy.horizonDays, 365),
    roundTo: readNumber(legacy.roundTo, 50),
    listings
  });
}
