import { z } from "zod";

export const PURPOSES = ["Tenant", "Visitor of Tenant", "Viewing"] as const;
export const BUILDING_CODES = ["A", "B", "C", "D"] as const;
export const INVITE_STATUSES = ["open", "submitted"] as const;
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

export const guestSubmissionSchema = z.object({
  guestEmail: z.string().email("Guest email is required"),
  guests: z.array(guestSchema).min(1).max(10),
  acceptedRules: z.literal(true)
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
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type PublicInvite = z.infer<typeof publicInviteSchema>;

export type InviteSummary = {
  id: string;
  guestUrl: string | null;
  checkIn: string;
  checkOut: string;
  purpose: Purpose;
  status: InviteStatus | "expired";
  expiresAt: string;
  createdAt: string;
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
