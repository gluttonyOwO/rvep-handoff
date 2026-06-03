import { z } from "zod";

export const livekitTokenSchema = z.object({
  vehicleId: z.string().min(1, "vehicleId is required"),
  role: z.enum(["operator", "viewer", "admin"], {
    errorMap: () => ({ message: "role must be operator | viewer | admin" }),
  }),
});

export type LivekitTokenBody = z.infer<typeof livekitTokenSchema>;
