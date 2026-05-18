import { z } from "zod";

export const PURPOSES = ["Tenant", "Visitor of Tenant", "Viewing"] as const;
export const BUILDING_CODES = ["A", "B", "C", "D"] as const;

export const guestSchema = z.object({
  fullName: z.string().trim().min(1, "Guest name is required"),
  age: z.coerce.number().int().min(0).max(120),
  idFileKey: z.string().optional()
});

export const publicInviteSchema = z.object({
  token: z.string(),
  checkIn: z.string(),
  checkOut: z.string(),
  buildingCode: z.enum(BUILDING_CODES),
  unitNumber: z.string(),
  ownerName: z.string(),
  ownerContact: z.string()
});

export const createInviteSchema = z.object({
  checkIn: z.string().min(1),
  checkOut: z.string().min(1),
  expiresAt: z.string().optional()
});

export const authEmailSchema = z.object({
  email: z.string().email()
});

export const createPasswordSchema = authEmailSchema.extend({
  password: z.string().min(8, "Password must be at least 8 characters")
});

export const guestSubmissionSchema = z.object({
  guestEmail: z.string().email("Guest email is required"),
  purpose: z.enum(PURPOSES),
  guests: z.array(guestSchema).min(1).max(10),
  acceptedRules: z.literal(true)
});

export const adminSubmissionSchema = guestSubmissionSchema.extend({
  buildingCode: z.enum(BUILDING_CODES),
  unitNumber: z.string().trim().min(1),
  checkIn: z.string(),
  checkOut: z.string(),
  ownerName: z.string().trim().min(1),
  ownerContact: z.string().trim().min(1)
});

export const MINOR_ID_CUTOFF = 16;

export type Purpose = (typeof PURPOSES)[number];
export type BuildingCode = (typeof BUILDING_CODES)[number];
export type GuestSubmission = z.infer<typeof guestSubmissionSchema>;
export type AdminSubmission = z.infer<typeof adminSubmissionSchema>;
export type CreateInviteInput = z.infer<typeof createInviteSchema>;
export type AuthEmailInput = z.infer<typeof authEmailSchema>;
export type CreatePasswordInput = z.infer<typeof createPasswordSchema>;
export type PublicInvite = z.infer<typeof publicInviteSchema>;
