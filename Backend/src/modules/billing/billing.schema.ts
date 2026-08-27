import { z } from "zod";

export const checkoutSchema = z.object({
  planCode: z.string().trim().min(1).max(64),
});

export type CheckoutInput = z.infer<typeof checkoutSchema>;
