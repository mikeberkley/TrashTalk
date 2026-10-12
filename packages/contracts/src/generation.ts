import { z } from "zod";
export const generationInputSchema = z
  .object({
    gameId: z.string().regex(/^[a-z]+:\d+$/),
    favoriteTeamId: z
      .string()
      .regex(/^espn:(football|basketball|baseball|hockey|soccer):\d+$/),
    includeWord: z.string().max(64).optional(),
    referenceIds: z.array(z.string().uuid()).max(1).default([]),
  })
  .strict();
export type GenerationInput = z.infer<typeof generationInputSchema>;
export const offer = {
  pack: "four-v1",
  currency: "usd",
  priceCents: 99,
  credits: 4,
  trial: 3,
} as const;

export const offerPrice = "$" + (offer.priceCents / 100).toFixed(2);
