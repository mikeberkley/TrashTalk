import catalog from './catalog.json';
export type VenuePhoto = {
  images: string[];
  credit: string;
  sourceUrl: string;
};
export type VenueImage = { href: string; rel?: string[] };
const normalized = (name: string) =>
  name
    .split(' · ')[0]
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
function catalogVenue(venue: string, venueId?: string) {
  // An explicit ID wins; never substitute a home-team stadium for a neutral venue.
  return venueId
    ? catalog.find((v) => v.id === venueId)
    : catalog.find((v) =>
        [v.name, ...v.aliases].some(
          (name) => normalized(name) === normalized(venue),
        ),
      );
}
export function venueLabel(venue: string, venueId?: string, location?: string) {
  const [name, ...embeddedLocation] = venue.split(' · ');
  const place =
    location ||
    embeddedLocation.join(' · ') ||
    catalogVenue(venue, venueId)?.location;
  return place ? `${name} · ${place}` : name;
}
export function catalogVenuePhoto(
  venue: string,
  venueId?: string,
): VenuePhoto | undefined {
  const entry = catalogVenue(venue, venueId);
  return entry
    ? { images: entry.images, credit: entry.credit, sourceUrl: entry.sourceUrl }
    : undefined;
}
export function espnVenuePhoto(
  images: VenueImage[] | undefined,
  eventId: string,
): VenuePhoto | undefined {
  const urls = [
    ...new Set(
      (images ?? [])
        .filter((i) => /^https:\/\/a\.espncdn\.com\/i\/venues\//.test(i.href))
        .sort(
          (a, b) =>
            Number(b.rel?.includes('interior') ?? false) -
            Number(a.rel?.includes('interior') ?? false),
        )
        .map((i) => i.href),
    ),
  ];
  return urls.length
    ? {
        images: urls,
        credit: 'ESPN',
        sourceUrl: `https://www.espn.com/nfl/game/_/gameId/${eventId}`,
      }
    : undefined;
}
