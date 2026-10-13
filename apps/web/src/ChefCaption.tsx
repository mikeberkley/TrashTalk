import { useEffect, useState } from "react";

export const chefPhrases = [
  "Baptizing the bunnies in nacho cheese",
  "Giving AI access to the nuclear codes",
  "Cross-examining the woke sous chef",
  "Explaining why pillow fights are illegal in Texas",
  "Parents just turned out the lights",
  "Stuffing the turkey with metaphor",
  "Appointing a raisin as your attorney",
  "The doctor finally left the room",
  "Dancing in the panda nut batter",
  "Mixing gravity with egg nog",
  "Bribing the maid to forget what she witnessed",
  "Launching gravy into witness protection",
  "Giving the rotisserie chicken immunity",
  "Taking the hostages to KFC",
  "The wedding cake knows everything",
  "The kitchen has lost institutional control",
  "Butter just declared sovereignty",
  "Your whisk is no longer talking",
  "All remaining adults are gone",
  "The muffin, so achingly beautiful",
];

export function shuffledChefPhrases(previous?: string) {
  const phrases = [...chefPhrases];
  for (let i = phrases.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [phrases[i], phrases[j]] = [phrases[j], phrases[i]];
  }
  if (phrases[0] === previous) {
    const j = 1 + Math.floor(Math.random() * (phrases.length - 1));
    [phrases[0], phrases[j]] = [phrases[j], phrases[0]];
  }
  return phrases;
}

export function ChefCaption() {
  const [rotation, setRotation] = useState(() => ({
    phrases: shuffledChefPhrases(),
    index: 0,
  }));
  useEffect(() => {
    const timer = window.setInterval(() => {
      setRotation((current) =>
        current.index < current.phrases.length - 1
          ? { ...current, index: current.index + 1 }
          : {
              phrases: shuffledChefPhrases(current.phrases[current.index]),
              index: 0,
            },
      );
    }, 10000);
    return () => window.clearInterval(timer);
  }, []);
  return (
    <h2 className="chef-caption" aria-live="off">
      {rotation.phrases[rotation.index]}
    </h2>
  );
}
