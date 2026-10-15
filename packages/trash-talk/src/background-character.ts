export const backgroundPeople = [
  "Doctor",
  "Nurse",
  "Surgeon",
  "Dentist",
  "Priest",
  "Nun",
  "Repair technician",
  "Plumber",
  "Electrician",
  "Barber",
  "Farmer",
  "Scientist",
  "Astronaut",
  "Firefighter",
  "Chef",
  "Baker",
  "Mail carrier",
  "Librarian",
  "Janitor",
  "Accountant",
  "Judge",
  "Orchestra conductor",
  "Magician",
  "Scuba diver",
];
export const backgroundObjects = [
  "Cracked porcelain doll",
  "Tattered teddy bear",
  "Wind-up toy robot",
  "Rubber duck",
  "Deflated balloon",
  "Broken umbrella",
  "Traffic cone",
  "Parking meter",
  "Shopping cart",
  "Office printer",
  "Rotary telephone",
  "Alarm clock",
  "Desk fan",
  "Vacuum cleaner",
  "Toaster",
  "Refrigerator",
  "Vending machine",
  "Washing machine",
  "Toilet plunger",
  "Single muddy boot",
  "Overstuffed suitcase",
  "Rotting banana",
  "Moldy birthday cake",
  "Crushed juice carton",
];
export const backgroundCharacters = [...backgroundPeople, ...backgroundObjects];
export function selectBackgroundCharacter(recent: string[], seed: string) {
  const known = recent.filter((name) => backgroundCharacters.includes(name));
  const pool = backgroundPeople.includes(known[0])
    ? backgroundObjects
    : backgroundPeople;
  const age = (name: string) => {
    const index = known.indexOf(name);
    return index < 0 ? Infinity : index;
  };
  const oldest = Math.max(...pool.map(age));
  const choices = pool.filter((name) => age(name) === oldest);
  const hash = [...seed].reduce(
    (n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0,
    0,
  );
  return choices[hash % choices.length];
}
export function backgroundInstruction(name: string) {
  if (!backgroundCharacters.includes(name))
    throw Error("Unknown background character");
  const subject = backgroundObjects.includes(name)
    ? `an anthropomorphic ${name.toLowerCase()}, with humanlike limbs and an expressive face`
    : `a ${name.toLowerCase()}`;
  return `Include exactly one small background cameo: ${subject}. Invent a dramatic, oddly specific expression, outfit, and activity unrelated to the main joke. Keep this character oblivious to the central action, ignoring the main subject, and clearly secondary in size and prominence. Do not substitute another background character.`;
}
