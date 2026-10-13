import { useEffect, useRef, useState } from "react";

type Meme = { token: string; createdAt: number };
export function SharedGallery() {
  const [items, setItems] = useState<Meme[]>([]);
  const [cursor, setCursor] = useState<string | null | undefined>(undefined);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  async function load() {
    if (inFlight.current || cursor === null) return;
    inFlight.current = true;
    setLoading(true);
    setError(false);
    try {
      const response = await fetch(
        `/api/shared-memes${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
      );
      if (!response.ok) throw Error();
      const data = (await response.json()) as {
        items: Meme[];
        nextCursor: string | null;
      };
      setItems((previous) => [
        ...previous,
        ...data.items.filter(
          (item: Meme) => !previous.some((p) => p.token === item.token),
        ),
      ]);
      setCursor(data.nextCursor);
    } catch {
      setError(true);
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  }
  useEffect(() => {
    if (cursor === null || error || loading) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void load();
      },
      { rootMargin: "200px" },
    );
    if (sentinel.current) observer.observe(sentinel.current);
    return () => observer.disconnect();
  }, [cursor, error, loading]);
  return (
    <section
      className="shared-gallery"
      aria-labelledby="shared-gallery-heading"
    >
      <h2 id="shared-gallery-heading">Fresh trash talk</h2>
      <div className="shared-gallery-grid">
        {items.map((item) => (
          <a
            key={item.token}
            href={`/m/${item.token}`}
            aria-label="Open shared meme"
          >
            <img
              src={`/m/${item.token}/image`}
              alt="Shared trash talk meme"
              loading="lazy"
              decoding="async"
            />
          </a>
        ))}
      </div>
      <div ref={sentinel} aria-live="polite">
        {loading && <p>Loading memes…</p>}
        {error && (
          <p>
            Couldn’t load memes.{" "}
            <button onClick={() => void load()}>Try again</button>
          </p>
        )}
        {cursor === null && !items.length && (
          <p>Shared memes will appear here.</p>
        )}
      </div>
      {cursor !== null && !loading && !error && (
        <button className="gallery-more" onClick={() => void load()}>
          Load more
        </button>
      )}
    </section>
  );
}
