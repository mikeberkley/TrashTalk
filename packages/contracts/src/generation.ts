import { z } from "zod";
import { leagues } from "./leagues";
const teamNamespaces = new Set(leagues.map((league) => league.teamNamespace));
const leagueIds = new Set(leagues.map((league) => league.id));
export const generationInputSchema = z
  .object({
    gameId: z.string().refine((value) => {
      const match = /^([a-z0-9]+):\d+$/.exec(value);
      return !!match && leagueIds.has(match[1]);
    }, "Choose a supported game."),
    favoriteTeamId: z.string().refine((value) => {
      const match = /^espn:([a-z-]+):\d+$/.exec(value);
      return !!match && teamNamespaces.has(match[1]);
    }, "Choose a supported team."),
    includeWord: z.string().max(64).optional(),
    referenceIds: z.array(z.string().uuid()).max(1).default([]),
  })
  .strict();
export type GenerationInput = z.infer<typeof generationInputSchema>;
export const offer = {
  pack: "ten-v1",
  currency: "usd",
  priceCents: 199,
  credits: 10,
  trial: 3,
} as const;

export const offerPrice = "$" + (offer.priceCents / 100).toFixed(2);
