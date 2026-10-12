// Keep kickoff dates consistent between the browser and social crawlers.
export function pregameShareDate(scheduledAt: string) {
  const date = new Date(scheduledAt);
  if (!Number.isFinite(date.getTime())) return undefined;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}
export function pregameShareTitle(matchup: string, day?: string) {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return undefined;
  const date = new Date(`${day}T12:00:00Z`);
  if (
    !Number.isFinite(date.getTime()) ||
    date.toISOString().slice(0, 10) !== day
  )
    return undefined;
  const label = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  })
    .format(date)
    .replaceAll(',', '');
  return `${matchup} on ${label}`;
}
