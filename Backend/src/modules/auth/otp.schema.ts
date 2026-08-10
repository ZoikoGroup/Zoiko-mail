import { z } from "zod";

// validate() parses req.body directly, so this is flat (no { body } wrapper).
export const verifyOtpSchema = z.object({
  code: z.string().regex(/^\d{4,10}$/, "Code must be 4–10 digits"),
});

export type VerifyOtpInput = z.infer<typeof verifyOtpSchema>;