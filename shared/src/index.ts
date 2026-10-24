import { z } from "zod";
import type { PricingConfig } from "./pricing-schema.js";

export const PURPOSES = ["Tenant", "Visitor of Tenant", "Viewing"] as const;
export const BUILDING_CODES = ["A", "B", "C", "D"] as const;
export const INVITE_STATUSES = ["open", "submitted"] as const;
export const BOOKING_STATUSES = [
  "accepted",
  "cancelled",
  "wait_accept",
  "wait_pay",
  "denied",
  "timeout"
] as const;
export const SUBMISSION_STATUSES = [
  "ai_check_pending",
  "ai_checking",
  "ai_review_required",
  "ready_for_review",
  "queued",
  "submitting",
  "failed",
  "submitted_email_failed",
  "rejected",
  "submitted",
  "submitted_email_sent"
] as const;

export const MINOR_ID_CUTOFF = 16;
export const SENIOR_ID_CUTOFF = 60;

/** OTA relay addresses (Booking.com, Agoda, Airbnb) that don't reach the guest's own inbox. */
export function isRelayEmail(email: string | null | undefined) {
  if (!email?.trim()) return true;
  return /@(guest\.booking\.com|[\w.-]*agoda[\w.-]*|guest\.airbnb\.com|[\w.-]*expediapartnercentral\.com)$/i.test(
    email.trim()
  );
}

export function requiresGuestId(age: number, lowerCutoff = MINOR_ID_CUTOFF, upperCutoff = SENIOR_ID_CUTOFF) {
  return age >= lowerCutoff && age < upperCutoff;
}

export const guestSchema = z.object({
  fullName: z.string().trim().min(1, "Guest name is required"),
  age: z.coerce.number().int().min(0).max(120),
  idFileKey: z.string().optional()
});

export const createInviteSchema = z
  .object({
    checkIn: z.string().date(),
    checkOut: z.string().date(),
    purpose: z.enum(PURPOSES, { message: "Purpose is required" }),
    expiresAt: z.string().datetime().optional()
  })
  .refine((value) => value.checkOut >= value.checkIn, {
    message: "Check-out must be on or after check-in",
    path: ["checkOut"]
  });

export const createBookingInviteSchema = z.object({
  purpose: z.enum(PURPOSES, { message: "Purpose is required" }),
  expiresAt: z.string().datetime().optional()
});

export const updateInviteSchema = z.object({
  purpose: z.enum(PURPOSES).optional(),
  expiresAt: z.string().datetime().optional()
});

export const regenerateInviteSchema = z.object({
  expiresAt: z.string().datetime().optional()
});

export const emailInviteSchema = z.object({ email: z.string().trim().email("Enter a valid email") });

export const assignInviteBookingSchema = z.object({ bookingId: z.string().uuid().nullable() });

export const guestSubmissionSchema = z.object({
  guestEmail: z.string().email("Guest email is required"),
  guests: z.array(guestSchema).min(1).max(10),
  acceptedRules: z.literal(true)
});

export const editableGuestSchema = z.object({
  id: z.string().uuid().optional(),
  fullName: z.string().trim().min(1, "Guest name is required"),
  age: z.coerce.number().int().min(0).max(120),
  retainFileIds: z.array(z.string().uuid()).default([]),
  idFileKey: z.string().optional()
});

export const updateSubmissionSchema = z.object({
  guestEmail: z.string().email("Guest email is required"),
  purpose: z.enum(PURPOSES),
  guests: z.array(editableGuestSchema).min(1).max(10)
});

export const publicInviteSchema = z.object({
  token: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  buildingCode: z.enum(BUILDING_CODES),
  unitNumber: z.string(),
  purpose: z.enum(PURPOSES),
  ownerName: z.string(),
  ownerContact: z.string(),
  minorIdCutoff: z.number().int(),
  seniorIdCutoff: z.number().int()
});

export type Purpose = (typeof PURPOSES)[number];
export type BuildingCode = (typeof BUILDING_CODES)[number];
export type InviteStatus = (typeof INVITE_STATUSES)[number];
export type SubmissionStatus = (typeof SUBMISSION_STATUSES)[number];
export type GuestSubmission = z.infer<typeof guestSubmissionSchema>;
export type UpdateSubmissionInput = z.infer<typeof updateSubmissionSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type CreateBookingInviteInput = z.infer<typeof createBookingInviteSchema>;
export type UpdateInviteInput = z.infer<typeof updateInviteSchema>;
export type RegenerateInviteInput = z.infer<typeof regenerateInviteSchema>;
export type PublicInvite = z.infer<typeof publicInviteSchema>;
export type EmailInviteInput = z.infer<typeof emailInviteSchema>;

export type InviteSummary = {
  id: string;
  guestUrl: string | null;
  checkIn: string;
  checkOut: string;
  purpose: Purpose;
  status: InviteStatus | "expired" | "revoked";
  expiresAt: string;
  createdAt: string;
  hostex?: {
    channelType: string;
    status:
      | "scheduled"
      | "sending"
      | "sent"
      | "confirmed"
      | "retry_wait"
      | "blocked"
      | "unknown"
      | "cancelled"
      | "skipped_submitted";
    dueAt: string;
    attempts: number;
    sentAt?: string | null;
    confirmedAt?: string | null;
    lastError?: string | null;
  };
  booking?: {
    id: string;
    guestName?: string | null;
    channelType: string;
    stayCode: string;
  } | null;
};

export type BookingRegistration = {
  invite: InviteSummary;
  submission?: SubmissionSummary | null;
  deliveries: Array<{
    id: string;
    kind: "automated" | "manual" | "email";
    /** Recipient, for email deliveries. */
    to?: string | null;
    status: InviteSummary["hostex"] extends infer T ? (T extends { status: infer S } ? S : string) : string;
    attempts: number;
    sentAt?: string | null;
    confirmedAt?: string | null;
    lastError?: string | null;
  }>;
};

export type BookingSummary = {
  id: string;
  reservationCode: string;
  stayCode: string;
  propertyId: number;
  channelType: string;
  status: string;
  guestName?: string | null;
  guestEmail?: string | null;
  guestPhone?: string | null;
  numberOfGuests?: number | null;
  conversationId?: string | null;
  checkIn: string;
  checkOut: string;
  lastSyncedAt: string;
  registrationStatus: "needs_registration" | "pending" | "review" | "done" | "rejected";
  registrationCount: number;
};

export type BookingDetail = BookingSummary & {
  channelId?: string | null;
  listingId?: string | null;
  numberOfAdults?: number | null;
  numberOfChildren?: number | null;
  bookedAt?: string | null;
  cancelledAt?: string | null;
  registrations: BookingRegistration[];
};

export type CalendarBooking = Pick<
  BookingSummary,
  "id" | "guestName" | "channelType" | "status" | "checkIn" | "checkOut" | "registrationStatus"
>;

export type CalendarDay = {
  date: string;
  available: boolean | null;
  airbnbPrice: number | null;
  recommendedPrice: number | null;
  recommendedMinStay?: number | null;
  event?: string | null;
  reasons: string[];
  channels: Array<{
    channelType: string;
    listingId: string;
    price: number | null;
    inventory: number | null;
    restrictions: unknown;
  }>;
};

export type CalendarMonth = {
  start: string;
  end: string;
  syncedAt?: string | null;
  warning?: string | null;
  bookings: CalendarBooking[];
  days: CalendarDay[];
};

export {
  PRICING_ALGORITHM,
  airbnbExtraGuestFeeError,
  pricingConfigSchema,
  pricingEventSchema,
  pricingListingSchema
} from "./pricing-schema.js";
export type { PricingConfig, PricingEvent, PricingListing } from "./pricing-schema.js";
export type PricingSettings = {
  version: number;
  automationOn: boolean;
  automationAvailable: boolean;
  config: PricingConfig;
  updatedAt: string;
  updatedBy?: string | null;
  history: Array<{
    version: number;
    changedBy?: string | null;
    createdAt: string;
  }>;
};

export type PricingRestrictionRange = {
  start_date: string;
  end_date: string;
  min_stay_on_arrival: number;
};

export type PricingChannelRestrictions = {
  channelType: string;
  listingId: string;
  restrictions: PricingRestrictionRange[];
};

export type PricingDay = {
  date: string;
  leadDays?: number;
  minStay: number;
  platformPrices?: Array<{ channelType: string; listingId: string; price: number }>;
  airbnbPrice: number;
  available: boolean;
  occupancyRatio: number;
  event?: string | null;
  reasons: string[];
};

export type PricingRun = {
  id: string;
  mode: "preview" | "manual" | "automatic";
  status: "running" | "previewed" | "submitted" | "partial_failed" | "failed";
  settingsVersion: number;
  initiatedBy?: string | null;
  errorMessage?: string | null;
  startedAt: string;
  finishedAt?: string | null;
  submissions?: Array<{
    id: string;
    channelType: string;
    listingId: string;
    attempt: number;
    status: string;
    requestId?: string | null;
    error?: string | null;
    createdAt: string;
  }>;
};

export type PricingLengthOfStay = {
  weeklyDiscountPercent: number;
  monthlyDiscountPercent: number;
  appliedByAutomation: false;
  note: string;
};

export type PricingExtraGuest = {
  fee: number;
  includedGuests: number;
  airbnb: "pushed-on-apply";
  otherChannels: "manual";
};

export type PricingPreview = PricingRun & {
  occupancy: Record<string, { booked: number; total: number; ratio: number }>;
  days: PricingDay[];
  restrictions: PricingChannelRestrictions[];
  lengthOfStay: PricingLengthOfStay | null;
  extraGuest: PricingExtraGuest | null;
};

export const airbnbDiscountRuleSchema = z
  .object({
    discount: z.coerce.number().int().min(0).max(100),
    days: z.coerce.number().int().min(1).max(365)
  })
  .strict();

const airbnbWeekdaySchema = z.coerce.number().int().min(0).max(6);

export const airbnbPricingRulesPatchSchema = z
  .object({
    weeklyDiscount: z.coerce.number().int().min(0).max(100).optional(),
    monthlyDiscount: z.coerce.number().int().min(0).max(100).optional(),
    earlyBirdDiscount: z.array(airbnbDiscountRuleSchema).max(20).optional(),
    lastMinuteDiscount: z.array(airbnbDiscountRuleSchema).max(20).optional(),
    highRatedGuestDiscount: z.boolean().optional(),
    mobileOnlyDiscount: z.boolean().optional(),
    minimumStay: z.coerce.number().int().min(1).max(365).optional(),
    maximumStay: z.coerce.number().int().min(1).max(1125).optional(),
    advanceNotice: z.coerce.number().int().min(0).max(8760).optional(),
    availabilityWindow: z.coerce.number().int().min(1).max(1095).optional(),
    preparationTime: z.coerce.number().int().min(0).max(7).optional(),
    daysOfWeekCheckIn: z.array(airbnbWeekdaySchema).max(7).optional(),
    daysOfWeekCheckOut: z.array(airbnbWeekdaySchema).max(7).optional()
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "At least one Airbnb setting is required")
  .refine(
    (value) =>
      value.minimumStay === undefined ||
      value.maximumStay === undefined ||
      value.minimumStay <= value.maximumStay,
    { message: "Minimum stay cannot exceed maximum stay", path: ["minimumStay"] }
  );

export type AirbnbDiscountRule = z.infer<typeof airbnbDiscountRuleSchema>;
export type AirbnbPricingRulesPatch = z.infer<typeof airbnbPricingRulesPatchSchema>;
export type AirbnbPricingRules = {
  listingId: string;
  listingCurrency: string;
  basePrice: number;
  weekendPrice: number | null;
  longTermDiscount: AirbnbDiscountRule[];
  earlyBirdDiscount: AirbnbDiscountRule[];
  lastMinuteDiscount: AirbnbDiscountRule[];
  highRatedGuestDiscount: boolean;
  mobileOnlyDiscount: boolean;
  minimumStay: number;
  maximumStay: number;
  advanceNotice: number | null;
  availabilityWindow: number;
  preparationTime: number;
  daysOfWeekCheckIn: number[];
  daysOfWeekCheckOut: number[];
  syncedAt: string;
};

export type HostexAutomationStatus = {
  webhookVerified: boolean;
  webhookVerifiedAt: string | null;
  automationEnabled: boolean;
};

export type SubmissionSummary = {
  id: string;
  guestEmail: string;
  checkIn: string;
  checkOut: string;
  status: SubmissionStatus;
  createdAt: string;
};

export type GuestFileView = {
  id: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  url: string;
};

export type EntrancePassChatDelivery = {
  id: string;
  status: string;
  message: string;
  emailSentAt: string | null;
  sentAt: string | null;
  createdAt: string;
  lastError: string | null;
};

export type SubmissionDetail = SubmissionSummary & {
  chatDeliveries?: EntrancePassChatDelivery[];
  buildingCode: BuildingCode;
  unitNumber: string;
  purpose: Purpose;
  ownerName: string;
  ownerContact: string;
  guests: Array<{
    id: string;
    fullName: string;
    age: number;
    requiresId: boolean;
    files: GuestFileView[];
  }>;
  aiReview?: {
    status: "pending" | "checking" | "passed" | "rejected" | "review_required";
    model: string;
    checkedAt?: string | null;
    notificationSentAt?: string | null;
    notificationError?: string | null;
    error?: string | null;
    results: Array<{
      guestId: string;
      enteredName: string;
      extractedName?: string | null;
      extractedNames?: string[];
      matchedName?: string | null;
      verdict: "match" | "clear_mismatch" | "uncertain";
      confidence: number;
      reason: string;
    }>;
  } | null;
};

export type EmailTemplate = {
  subject: string;
  html: string;
};

export const EMAIL_TEMPLATE_KINDS = ["tenant", "visitorViewing"] as const;
export type EmailTemplateKind = (typeof EMAIL_TEMPLATE_KINDS)[number];
export type EmailTemplateSet = Record<EmailTemplateKind, EmailTemplate>;

export type SettingsStatus = {
  autoQueue: boolean;
  aiIdCheck: {
    enabled: boolean;
    configured: boolean;
    model: string;
    reviewEmail: string;
  };
  connected: boolean;
  hasStorageState: boolean;
  pendingVerification: boolean;
  expired: boolean;
  connectedAt?: string;
  accountEmail?: string;
  lastCheck?: {
    checkedAt: string;
    valid: boolean;
    message: string;
    currentUrl?: string;
  } | null;
  email: {
    configured: boolean;
    mode: "agentmail_api";
  };
  googleRecovery: {
    configured: boolean;
    enabled: boolean;
    state: "idle" | "recovering" | "manual_required";
    expectedAccount: string;
    incidentId?: string;
    lastAttemptAt?: string;
    lastSuccessAt?: string;
    lastError?: string;
    leaseUntil?: string;
    alertDelivery: {
      attempts: number;
      sentAt?: string;
      error?: string;
    };
  };
};

export { PRICING_TIERS, pricingTier, tierPrice, channelPrice, startingPrice } from "./pricing.js";
export {
  DEFAULT_CHANNEL_RATIOS,
  DEMAND_PRICING_DEFAULTS,
  PRICING_EVENTS,
  defaultListingRatio,
  listingsWithDefaultRatios,
  pricingConfigWithDefaults
} from "./pricing-calendar.js";
export { pricingPreviewCsv } from "./pricing-csv.js";
