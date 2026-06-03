import { z } from "zod";

export const grantPermissionSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  role: z.enum(["OPERATOR", "VIEWER", "ADMIN"], {
    errorMap: () => ({ message: "role must be OPERATOR | VIEWER | ADMIN" }),
  }),
});

export type GrantPermissionBody = z.infer<typeof grantPermissionSchema>;

export const claimLeaseSchema = z.object({
  sessionId: z.string().min(1, "sessionId is required"),
});

export type ClaimLeaseBody = z.infer<typeof claimLeaseSchema>;

export const takeoverLeaseSchema = z.object({
  reason: z.string().min(1, "reason is required"),
  newOperatorId: z.string().min(1, "newOperatorId is required"),
});

export type TakeoverLeaseBody = z.infer<typeof takeoverLeaseSchema>;
