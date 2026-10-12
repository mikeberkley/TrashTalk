import {
  RegExpMatcher,
  englishDataset,
  englishRecommendedTransformers,
} from "obscenity";

export const INCLUDE_WORD_MAX_LENGTH = 30;
const profanity = new RegExpMatcher({
  ...englishDataset.build(),
  ...englishRecommendedTransformers,
});
// Include mild swears omitted from the library's default English dataset.
const mildSwear =
  /^(?:damn(?:ed|it)?|goddamn(?:ed|it)?|hell|crap(?:py)?|bullcrap)$/i;
export function validateIncludeWord(
  value: unknown,
): { word: string; error?: never } | { word?: never; error: string } {
  if (value === undefined) return { word: "" };
  if (typeof value !== "string")
    return { error: "Enter one word using letters only." };
  const word = value.trim();
  if (!word) return { word: "" };
  if (!/^[a-z]+$/i.test(word))
    return {
      error:
        "Enter one word using letters only—no spaces, numbers, or punctuation.",
    };
  if (word.length > INCLUDE_WORD_MAX_LENGTH)
    return {
      error: `Keep your word to ${INCLUDE_WORD_MAX_LENGTH} letters or fewer.`,
    };
  if (profanity.hasMatch(word) || mildSwear.test(word))
    return { error: "Please choose a word without swearing." };
  return { word };
}
export function captionIncludesWord(caption: string, word: string) {
  // Compare full words, never substrings such as “cat” within “catch”.
  return (caption.match(/[\p{L}\p{N}]+/gu) ?? []).some(
    (token) => token.toLowerCase() === word.toLowerCase(),
  );
}
