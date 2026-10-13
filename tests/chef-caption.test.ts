import { expect, it, vi } from "vitest";
import { chefPhrases, shuffledChefPhrases } from "../apps/web/src/ChefCaption";

it("shuffles a complete round without omissions or duplicates", () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    const order = shuffledChefPhrases();
    expect([...order].sort()).toEqual([...chefPhrases].sort());
    expect(order).not.toEqual(chefPhrases);
  } finally {
    random.mockRestore();
  }
});
it("avoids repeating the last phrase at the start of the next round", () => {
  const random = vi.spyOn(Math, "random").mockReturnValue(0);
  try {
    const previous = shuffledChefPhrases()[0];
    const order = shuffledChefPhrases(previous);
    expect(order[0]).not.toBe(previous);
    expect([...order].sort()).toEqual([...chefPhrases].sort());
  } finally {
    random.mockRestore();
  }
});
