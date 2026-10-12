import { TrashTalkImageViewer } from './TrashTalkImageViewer';
import {
  pregameShareDate,
  pregameShareTitle,
} from '../../../packages/trash-talk/src/share-title';
import {
  validateIncludeWord,
  INCLUDE_WORD_MAX_LENGTH,
} from '../../../packages/trash-talk/src/include-word';
import { useEffect, useId, useRef, useState } from 'react';
import { Flame } from 'lucide-react';
import type { Snapshot, Poster } from '../../../packages/contracts/src';
import type { Side } from '../../../packages/fan/src';
import { type TrashTalkState } from '../../../packages/trash-talk/src';
import { PosterShare } from './PosterShare';
import { PosterStack } from './PosterStack';

const validState = (value: TrashTalkState) =>
  ['idle', 'pending', 'complete', 'failed'].includes(value.status) &&
  (value.status !== 'complete' || !!value.result?.url);

export function TrashTalk({
  s,
  side,
  delay,
}: {
  s: Snapshot;
  side: Side | null;
  delay: number;
}) {
  // A keyed child prevents any old perspective flashing on favorite changes.
  return (
    <TrashTalkCard
      key={`${s.id}:${s.generation}:${side}:${delay}`}
      s={s}
      side={side}
      delay={delay}
    />
  );
}
function TrashTalkCard({
  s,
  side,
  delay,
}: {
  s: Snapshot;
  side: Side | null;
  delay: number;
}) {
  const [state, setState] = useState<TrashTalkState>({ status: 'idle' });
  const [viewedImage, setViewedImage] = useState<Poster | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [editing, setEditing] = useState(false);
  const [includeWord, setIncludeWord] = useState('');
  const [wordError, setWordError] = useState('');
  const wordId = useId();
  const wordInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (editing) wordInput.current?.focus();
  }, [editing]);
  const [now, setNow] = useState(Date.now());
  const remaining = Math.max(
    0,
    Math.ceil(((state.nextAvailableAt ?? 0) - now) / 1000),
  );
  useEffect(() => {
    if (!state.nextAvailableAt) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [state.nextAvailableAt]);
  const active = useRef(true);
  const locked = useRef(false);
  const endpoint = `/api/games/${encodeURIComponent(s.id)}/trash-talk`;
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      if (delay > 0) return;
      let pending = state.status === 'pending';
      try {
        const states = await Promise.all(
          (side ? [side] : ['home', 'away']).map(async (perspective) => {
            const response = await fetch(`${endpoint}?side=${perspective}`, {
              signal: controller.signal,
            });
            if (!response.ok)
              throw Error('Couldn’t load Trash Talk. Try again.');
            const next: TrashTalkState = await response.json();
            if (!validState(next))
              throw Error('Trash Talk is updating. Try again shortly.');
            return next;
          }),
        );
        const next: TrashTalkState = side
          ? states[0]
          : {
              status: 'idle',
              images: [
                ...new Map(
                  states
                    .flatMap(
                      (state) =>
                        state.images ?? (state.result ? [state.result] : []),
                    )
                    .map((image) => [image.url, image] as const),
                ).values(),
              ].sort(
                (a, b) =>
                  a.generatedAt.localeCompare(b.generatedAt) ||
                  a.url.localeCompare(b.url),
              ),
            };
        if (!controller.signal.aborted) {
          setState(next);
          setError('');
          pending = next.status === 'pending';
        }
      } catch (e) {
        if (!controller.signal.aborted)
          setError(
            e instanceof Error ? e.message : 'Couldn’t load Trash Talk.',
          );
      }
      if (!controller.signal.aborted && (pending || !side))
        timer = setTimeout(load, pending ? 4000 : 15000);
    }
    void load();
    return () => {
      active.current = false;
      controller.abort();
      clearTimeout(timer);
    };
  }, [endpoint, side, delay, state.status]);
  const images = state.images ?? (state.result ? [state.result] : []);
  const posters: Poster[] = images.map((image) => ({
    id: image.url
      .split('/')
      .at(-1)!
      .replace(/\.(png|jpe?g)$/, ''),
    headline: image.text,
    stat: image.label,
    home: 0,
    away: 0,
    period: 0,
    clock: '',
    fallback: false,
    artworkOnly: false,
    url: image.url,
  }));
  if (!['scheduled', 'live', 'final'].includes(s.status)) return null;
  const shareDay =
    s.status === 'scheduled' ? pregameShareDate(s.scheduledAt) : undefined;
  const shareTitle =
    pregameShareTitle(`${s.away.name} vs ${s.home.name}`, shareDay) ??
    `${s.away.name} ${s.awayScore} - ${s.homeScore} ${s.home.name}`;
  const shareContext = shareDay
    ? `pregame=${shareDay}`
    : `score=${s.awayScore}-${s.homeScore}`;
  const waiting = s.status === 'scheduled' && !s.storylines?.cards.length;
  const busy = starting || state.status === 'pending';
  async function generate() {
    if (
      locked.current ||
      busy ||
      waiting ||
      !side ||
      delay > 0 ||
      remaining > 0
    )
      return;
    const checked = validateIncludeWord(includeWord);
    if (checked.error) {
      setWordError(checked.error);
      wordInput.current?.focus();
      return;
    }
    setWordError('');
    locked.current = true;
    setStarting(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          side,
          ...(checked.word ? { includeWord: checked.word } : {}),
        }),
      });
      const next: TrashTalkState = await response.json();
      if (active.current && next.nextAvailableAt) {
        setNow(Date.now());
        setState((previous) => ({
          ...previous,
          nextAvailableAt: next.nextAvailableAt,
        }));
      }
      if (!response.ok)
        throw Error(next.error ?? 'Couldn’t start Trash Talk. Try again.');
      if (!validState(next))
        throw Error('Trash Talk is updating. Try again shortly.');
      if (active.current) {
        setState(next);
        setEditing(false);
      }
    } catch (e) {
      if (active.current)
        setError(e instanceof Error ? e.message : 'Try again.');
    } finally {
      locked.current = false;
      if (active.current) setStarting(false);
    }
  }
  return (
    <section className="panel trash-talk-card" aria-label="Trash Talk">
      <div className="trash-talk-heading">
        <span className="eyebrow">
          <Flame size={17} aria-hidden="true" /> TRASH TALK
        </span>
      </div>
      {delay > 0 ? (
        <p>Switch off broadcast delay to make Trash Talk without spoilers.</p>
      ) : (
        <>
          {posters.length > 0 && (
            <>
              <PosterStack
                posters={posters}
                ariaLabel="Trash Talk images"
                itemLabel="Image"
                showSwipeHint={false}
                caption={(p) => p.stat}
                renderPoster={(p) => (
                  <div className="trash-talk-art">
                    <img
                      className="trash-talk-image"
                      role="button"
                      tabIndex={0}
                      aria-label="View Trash Talk image full screen"
                      onClick={() => setViewedImage(p)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          setViewedImage(p);
                        }
                      }}
                      src={p.url}
                      alt={p.headline}
                      width={1024}
                      height={1024}
                    />
                    <PosterShare
                      imageLabel="Trash Talk"
                      game={s}
                      poster={p}
                      shareFooter="Shared from FanLift.ai"
                      shareUrl={`https://www.fanlift.ai/games/${encodeURIComponent(s.id)}?trashTalk=${encodeURIComponent(p.id)}&${shareContext}`}
                      shareTitle={shareTitle}
                    />
                  </div>
                )}
              />
            </>
          )}
          {busy ? (
            <div className="trash-talk-loading" role="status">
              <Flame size={34} aria-hidden="true" />
              <strong>Cooking up unreasonable confidence…</strong>
              <span>The image can take a minute. Keep following the game.</span>
            </div>
          ) : side && posters.length === 0 ? (
            <p>
              {waiting
                ? 'Your roast is waiting on the pregame briefing.'
                : `${s[side].name} loyalty. Absolutely zero chill.`}
            </p>
          ) : null}
        </>
      )}
      <div className="trash-talk-actions">
        {editing && !busy ? (
          <form
            className="trash-talk-word-form"
            onSubmit={(event) => {
              event.preventDefault();
              void generate();
            }}
            noValidate
          >
            <label htmlFor={wordId}>
              Include this word <span>(optional)</span>
            </label>
            <input
              ref={wordInput}
              id={wordId}
              type="text"
              value={includeWord}
              maxLength={INCLUDE_WORD_MAX_LENGTH}
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={!!wordError}
              aria-describedby={`${wordId}-help${wordError ? ` ${wordId}-error` : ''}`}
              onChange={(event) => {
                setIncludeWord(event.target.value);
                if (wordError)
                  setWordError(
                    validateIncludeWord(event.target.value).error ?? '',
                  );
              }}
            />
            <small id={`${wordId}-help`}>
              One word, letters only. No swearing.
            </small>
            {wordError && (
              <p id={`${wordId}-error`} role="alert" className="recap-error">
                {wordError}
              </p>
            )}
            <div className="trash-talk-word-buttons">
              <button
                type="button"
                className="trash-talk-cancel"
                onClick={() => {
                  setEditing(false);
                  setWordError('');
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="trash-talk-generate"
                disabled={
                  !side || busy || delay > 0 || waiting || remaining > 0
                }
              >
                Generate
              </button>
            </div>
          </form>
        ) : (
          <button
            className="trash-talk-generate"
            onClick={() => {
              setEditing(true);
              setWordError('');
            }}
            disabled={!side || busy || delay > 0 || waiting || remaining > 0}
          >
            <Flame size={17} aria-hidden="true" />
            {busy
              ? 'Cooking…'
              : remaining > 0
                ? `Try again in ${Math.floor(remaining / 60)}:${String(remaining % 60).padStart(2, '0')}`
                : posters.length
                  ? 'Generate new trash talk'
                  : 'Talk trash'}
          </button>
        )}
      </div>
      {!side && (
        <p className="trash-talk-neutral-hint">
          To trash talk, you must first pick at team above.
        </p>
      )}
      {viewedImage && (
        <TrashTalkImageViewer
          image={{ url: viewedImage.url!, headline: viewedImage.headline }}
          share={
            <PosterShare
              imageLabel="Trash Talk"
              game={s}
              poster={viewedImage}
              shareFooter="Shared from FanLift.ai"
              shareUrl={`https://www.fanlift.ai/games/${encodeURIComponent(s.id)}?trashTalk=${encodeURIComponent(viewedImage.id)}&${shareContext}`}
              shareTitle={shareTitle}
              showLabel
            />
          }
          onDismiss={() => setViewedImage(null)}
        />
      )}
      {(error || state.error) && (
        <p role="alert" className="recap-error">
          {error || state.error}
        </p>
      )}
    </section>
  );
}
