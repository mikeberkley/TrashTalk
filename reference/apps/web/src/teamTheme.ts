import type { Team } from '../../../packages/contracts/src';
const rgb = (hex: string) =>
  [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
function luminance(hex: string) {
  const c = rgb(hex).map((n) => {
    const v = n / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
export function contrast(a: string, b: string) {
  const x = luminance(a),
    y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
export function readableTeamColor(color: string) {
  if (!/^#[0-9a-f]{6}$/i.test(color)) return '#aab7c4';
  const original = rgb(color);
  let result = color;
  for (let mix = 0; contrast(result, '#111923') < 4.5 && mix < 1; mix += 0.025)
    result =
      '#' +
      original
        .map((n) =>
          Math.round(n + (255 - n) * mix)
            .toString(16)
            .padStart(2, '0'),
        )
        .join('');
  return result;
}
export function lightestTeamColor(
  team: Pick<Team, 'color' | 'secondaryColor'>,
) {
  const colors = [team.color, team.secondaryColor].filter(
    (c): c is string => !!c && /^#[0-9a-f]{6}$/i.test(c),
  );
  return colors.reduce(
    (best, c) => (luminance(c) > luminance(best) ? c : best),
    colors[0] ?? '#aab7c4',
  );
}
export function teamTheme(home: Team, away: Team) {
  const hc = lightestTeamColor(home),
    ac = lightestTeamColor(away);
  return {
    '--home-ink': contrast(hc, '#ffffff') >= 4.5 ? '#ffffff' : '#0b1018',
    '--away-ink': contrast(ac, '#ffffff') >= 4.5 ? '#ffffff' : '#0b1018',
    '--mint': readableTeamColor(hc),
    '--coral': readableTeamColor(ac),
    '--home-primary': hc,
    '--away-primary': ac,
    '--home-secondary': home.secondaryColor ?? home.color,
    '--away-secondary': away.secondaryColor ?? away.color,
  };
}
// Fade the team color into a dark surface; keep white text readable at the brightest stop.
export function fieldTheme(team: Pick<Team, 'color' | 'secondaryColor'>) {
  const color = /^#[0-9a-f]{6}$/i.test(team.color) ? team.color : '#111923';
  const base = rgb('#111923'),
    primary = rgb(color);
  const mix = (amount: number) =>
    '#' +
    primary
      .map((c, i) =>
        Math.round(c * amount + base[i] * (1 - amount))
          .toString(16)
          .padStart(2, '0'),
      )
      .join('');
  let amount = 0.65,
    background = mix(amount);
  while (contrast(background, '#ffffff') < 4.5 && amount > 0) {
    amount = Math.max(0, amount - 0.05);
    background = mix(amount);
  }
  const accent =
    team.secondaryColor && /^#[0-9a-f]{6}$/i.test(team.secondaryColor)
      ? team.secondaryColor
      : '#ffffff';
  return {
    '--field-background': background,
    '--field-ink': '#ffffff',
    '--field-accent': accent,
  };
}
