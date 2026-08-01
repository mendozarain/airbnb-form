import { z } from "zod";

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
  minorIdCutoff: z.number().int()
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
    kind: "automated" | "manual";
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
  bookings: CalendarBooking[];
  days: CalendarDay[];
};

export const pricingListingSchema = z.object({
  channelType: z.string().trim().min(1),
  listingId: z.string().trim().min(1),
  ratio: z.coerce.number().positive()
});

export const pricingEventSchema = z.object({
  name: z.string().trim().min(1),
  start: z.string().regex(/^\d{2}-\d{2}$/),
  end: z.string().regex(/^\d{2}-\d{2}$/)
});

export const pricingConfigSchema = z
  .object({
    propertyName: z.string().trim().min(1),
    propertyId: z.coerce.number().int().positive(),
    timezone: z.literal("Asia/Manila"),
    horizonDays: z.coerce.number().int().min(1).max(365),
    baseAirbnbPrice: z.coerce.number().int().positive(),
    minimumAirbnbPrice: z.coerce.number().int().positive(),
    maximumNonEventAirbnbPrice: z.coerce.number().int().positive(),
    rainySeasonDiscount: z.coerce.number().min(0).max(1),
    urgentGapDays: z.coerce.number().int().min(0).max(60),
    urgentGapDiscount: z.coerce.number().min(0).max(1),
    weekendPremium: z.coerce.number().min(0).max(1),
    lowOccupancyThreshold: z.coerce.number().min(0).max(1),
    lowOccupancyDiscount: z.coerce.number().min(0).max(1),
    lowOccupancyLeadDays: z.coerce.number().int().min(0).max(365),
    mediumOccupancyThreshold: z.coerce.number().min(0).max(1),
    mediumOccupancyPremium: z.coerce.number().min(0).max(1),
    highOccupancyThreshold: z.coerce.number().min(0).max(1),
    highOccupancyPremium: z.coerce.number().min(0).max(1),
    eventBoost: z.coerce.number().min(0).max(2),
    roundTo: z.coerce.number().int().positive(),
    listings: z.array(pricingListingSchema).min(1),
    recurringEvents: z.array(pricingEventSchema)
  })
  .refine((value) => value.minimumAirbnbPrice <= value.baseAirbnbPrice, {
    message: "Minimum price cannot exceed base price",
    path: ["minimumAirbnbPrice"]
  })
  .refine((value) => value.baseAirbnbPrice <= value.maximumNonEventAirbnbPrice, {
    message: "Base price cannot exceed maximum price",
    path: ["maximumNonEventAirbnbPrice"]
  })
  .refine((value) => value.lowOccupancyThreshold <= value.mediumOccupancyThreshold, {
    message: "Low occupancy threshold must not exceed medium threshold",
    path: ["lowOccupancyThreshold"]
  })
  .refine((value) => value.mediumOccupancyThreshold <= value.highOccupancyThreshold, {
    message: "Medium occupancy threshold must not exceed high threshold",
    path: ["mediumOccupancyThreshold"]
  });

export type PricingConfig = z.infer<typeof pricingConfigSchema>;
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

export type PricingDay = {
  date: string;
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

export type PricingPreview = PricingRun & {
  occupancy: Record<string, { booked: number; total: number; ratio: number }>;
  days: PricingDay[];
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

export type SubmissionDetail = SubmissionSummary & {
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
};

export type EmailTemplate = {
  subject: string;
  html: string;
};

export const EMAIL_TEMPLATE_KINDS = ["tenant", "visitorViewing"] as const;
export type EmailTemplateKind = (typeof EMAIL_TEMPLATE_KINDS)[number];
export type EmailTemplateSet = Record<EmailTemplateKind, EmailTemplate>;

export type SettingsStatus = {
  connected: boolean;
  hasStorageState: boolean;
  expired: boolean;
  connectedAt?: string;
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
};
