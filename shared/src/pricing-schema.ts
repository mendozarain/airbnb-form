import { z } from "zod";

// Replaces vacancy-tiers-v1, which cut every night toward the floor as arrival approached.
export const PRICING_ALGORITHM = "demand-pace-v1" as const;

export const pricingListingSchema = z.object({
  channelType: z.string().trim().min(1),
  listingId: z.string().trim().min(1),
  ratio: z.coerce.number().positive().max(3)
});

export const pricingEventSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    price: z.coerce.number().int().positive(),
    minPrice: z.coerce.number().int().positive().optional(),
    maxPrice: z.coerce.number().int().positive().optional(),
    minStay: z.coerce.number().int().min(1).max(30).optional(),
    weekendOnly: z.boolean().optional(),
    minStayOnWeekendsOnly: z.boolean().optional()
  })
  .superRefine((event, context) => {
    if (event.endDate < event.startDate) {
      context.addIssue({
        code: "custom",
        path: ["endDate"],
        message: "Event end is before the start"
      });
    }
    const minPrice = event.minPrice ?? event.price;
    const maxPrice = event.maxPrice ?? event.price;
    if (minPrice > event.price || event.price > maxPrice) {
      context.addIssue({
        code: "custom",
        path: ["price"],
        message: "Event price must sit between its minimum and maximum"
      });
    }
  });

export const pricingConfigSchema = z
  .object({
    algorithm: z.literal(PRICING_ALGORITHM),
    propertyName: z.string().trim().min(1),
    propertyId: z.coerce.number().int().positive(),
    timezone: z.literal("Asia/Manila"),
    horizonDays: z.coerce.number().int().min(1).max(365),
    roundTo: z.coerce.number().int().positive(),
    weekdayBasePrice: z.coerce.number().int().positive(),
    weekendBasePrice: z.coerce.number().int().positive(),
    weekdayFloor: z.coerce.number().int().positive(),
    weekendFloor: z.coerce.number().int().positive(),
    maximumPrice: z.coerce.number().int().positive(),
    lastMinuteLeadDays: z.coerce.number().int().min(0).max(30),
    lastMinuteWeekdayPrice: z.coerce.number().int().positive(),
    lastMinutePaceThreshold: z.coerce.number().min(0).max(1),
    paceHorizonDays: z.coerce.number().int().min(1).max(60),
    paceWindowDays: z.coerce.number().int().min(0).max(45),
    mediumOccupancyThreshold: z.coerce.number().min(0).max(1),
    mediumOccupancyPremium: z.coerce.number().min(0).max(1),
    highOccupancyThreshold: z.coerce.number().min(0).max(1),
    highOccupancyPremium: z.coerce.number().min(0).max(1),
    weekendScarcityPremium: z.coerce.number().min(0).max(1),
    defaultMinStay: z.coerce.number().int().min(1).max(30),
    weekendMinStay: z.coerce.number().int().min(1).max(30),
    minStayRelaxLeadDays: z.coerce.number().int().min(0).max(30),
    weeklyDiscountPercent: z.coerce.number().int().min(0).max(100),
    monthlyDiscountPercent: z.coerce.number().int().min(0).max(100),
    extraGuestFee: z.coerce.number().int().min(0),
    // Airbnb rejects a per-guest fee under this amount. The floor is a setting because Airbnb can change it.
    airbnbExtraGuestFeeMinimum: z.coerce.number().int().min(0).default(318),
    includedGuests: z.coerce.number().int().min(1).max(20),
    listings: z.array(pricingListingSchema).min(1),
    events: z.array(pricingEventSchema)
  })
  .superRefine((value, context) => {
    if (value.weekdayFloor > value.lastMinuteWeekdayPrice) {
      context.addIssue({
        code: "custom",
        path: ["lastMinuteWeekdayPrice"],
        message: "Last-minute weekday price cannot be below the weekday floor"
      });
    }
    if (value.lastMinuteWeekdayPrice > value.weekdayBasePrice) {
      context.addIssue({
        code: "custom",
        path: ["lastMinuteWeekdayPrice"],
        message: "Last-minute weekday price cannot exceed the weekday base"
      });
    }
    if (value.weekdayBasePrice > value.maximumPrice || value.weekendBasePrice > value.maximumPrice) {
      context.addIssue({
        code: "custom",
        path: ["maximumPrice"],
        message: "Ceiling must cover the weekday and weekend rates"
      });
    }
    if (value.weekendFloor > value.weekendBasePrice) {
      context.addIssue({
        code: "custom",
        path: ["weekendFloor"],
        message: "Weekend floor cannot exceed the weekend rate"
      });
    }
    if (value.weekdayFloor > value.weekendFloor) {
      context.addIssue({
        code: "custom",
        path: ["weekendFloor"],
        message: "Weekend floor cannot be below the weekday floor"
      });
    }
    const extraGuestFeeError = airbnbExtraGuestFeeError(
      value.extraGuestFee,
      value.airbnbExtraGuestFeeMinimum
    );
    if (extraGuestFeeError) {
      context.addIssue({
        code: "custom",
        path: ["extraGuestFee"],
        message: extraGuestFeeError
      });
    }
    if (value.defaultMinStay > value.weekendMinStay) {
      context.addIssue({
        code: "custom",
        path: ["weekendMinStay"],
        message: "Weekend minimum stay cannot be below the weekday minimum"
      });
    }
    if (value.mediumOccupancyThreshold > value.highOccupancyThreshold) {
      context.addIssue({
        code: "custom",
        path: ["highOccupancyThreshold"],
        message: "High-occupancy threshold must be at least the medium threshold"
      });
    }
    for (const [index, event] of value.events.entries()) {
      const maxPrice = event.maxPrice ?? event.price;
      if (maxPrice > value.maximumPrice) {
        context.addIssue({
          code: "custom",
          path: ["events", index, "maxPrice"],
          message: `${event.name} exceeds the price ceiling`
        });
      }
    }
    for (const listing of value.listings) {
      const channel = listing.channelType.toLowerCase();
      if (channel === "airbnb" && listing.ratio !== 1) {
        context.addIssue({
          code: "custom",
          path: ["listings"],
          message: "Airbnb must use the calculated nightly price without a markup"
        });
      }
      if (channel !== "airbnb" && listing.ratio < 1) {
        context.addIssue({
          code: "custom",
          path: ["listings"],
          message: `${listing.channelType} markup cannot price below the Airbnb night`
        });
      }
    }
  });

export function airbnbExtraGuestFeeError(fee: number, minimum: number): string | null {
  if (!Number.isInteger(minimum) || minimum < 0) {
    return "Airbnb extra-guest minimum must be a whole number of pesos";
  }
  if (!Number.isInteger(fee) || fee < minimum) {
    return `Airbnb extra-guest fee must be at least ₱${minimum} per guest per night`;
  }
  return null;
}

export type PricingListing = z.infer<typeof pricingListingSchema>;
export type PricingEvent = z.infer<typeof pricingEventSchema>;
export type PricingConfig = z.infer<typeof pricingConfigSchema>;
