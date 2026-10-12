import { ChevronLeft, ChevronRight } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import type { Poster } from '../../../packages/contracts/src';

type Props = {
  posters: Poster[];
  initialPosterId?: string | null;
  renderPoster: (poster: Poster) => React.ReactNode;
  ariaLabel?: string;
  itemLabel?: string;
  caption?: (poster: Poster) => string;
  showSwipeHint?: boolean;
};
export function PosterStack({
  posters,
  initialPosterId,
  renderPoster,
  ariaLabel = 'Game posters',
  itemLabel = 'Poster',
  caption,
  showSwipeHint = true,
}: Props) {
  // null follows the newest poster; browsing an older one stays put during live updates.
  const [selectedId, setSelectedId] = useState<string | null>(
    initialPosterId ?? null,
  );
  const [drag, setDrag] = useState(0);
  const [leaving, setLeaving] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    [],
  );
  const deck = useRef<HTMLDivElement>(null);
  const touchHandlers = useRef<{
    start: (e: TouchEvent) => void;
    move: (e: TouchEvent) => void;
    end: (e: TouchEvent) => void;
    cancel: () => void;
  } | null>(null);
  useEffect(() => {
    const element = deck.current;
    if (!element) return;
    const start = (e: TouchEvent) => touchHandlers.current?.start(e);
    const move = (e: TouchEvent) => touchHandlers.current?.move(e);
    const end = (e: TouchEvent) => touchHandlers.current?.end(e);
    const cancel = () => touchHandlers.current?.cancel();
    element.addEventListener('touchstart', start, { passive: true });
    element.addEventListener('touchmove', move, { passive: false });
    element.addEventListener('touchend', end);
    element.addEventListener('touchcancel', cancel);
    return () => {
      element.removeEventListener('touchstart', start);
      element.removeEventListener('touchmove', move);
      element.removeEventListener('touchend', end);
      element.removeEventListener('touchcancel', cancel);
    };
  }, [posters.length > 0]);
  const gesture = useRef<{
    id: number;
    x: number;
    y: number;
    horizontal?: boolean;
  } | null>(null);
  const ordered = posters.slice().reverse();
  const selectedIndex = selectedId
    ? ordered.findIndex((p) => p.id === selectedId)
    : 0;
  const index = Math.max(0, selectedIndex),
    poster = ordered[index];
  if (!poster) return null;
  const move = (step: number) => {
    const next = Math.max(0, Math.min(ordered.length - 1, index + step));
    setSelectedId(next === 0 ? null : ordered[next].id);
    setDrag(0);
  };
  const reset = () => {
    gesture.current = null;
    if (!timer.current) setDrag(0);
  };
  // Pull right to reveal older cards stacked to the left; left returns to newer cards.
  const swipeStep = (dx: number) => (dx < 0 ? -1 : 1);
  const swipeAway = (dx: number, width: number) => {
    const next = index + swipeStep(dx);
    if (next < 0 || next >= ordered.length) {
      reset();
      return;
    }
    const targetId = next === 0 ? null : ordered[next].id;
    gesture.current = null;
    setLeaving(true);
    setDrag(Math.sign(dx) * Math.max(width * 1.3, window.innerWidth + width));
    timer.current = setTimeout(() => {
      setSelectedId(targetId);
      setDrag(0);
      setLeaving(false);
      timer.current = null;
    }, 280);
  };
  touchHandlers.current = {
    start: (event) => {
      if (
        leaving ||
        ordered.length < 2 ||
        event.touches.length !== 1 ||
        (event.target as Element).closest('button,a,input,select,textarea')
      ) {
        reset();
        return;
      }
      const touch = event.touches[0];
      gesture.current = {
        id: touch.identifier,
        x: touch.clientX,
        y: touch.clientY,
      };
    },
    move: (event) => {
      const start = gesture.current;
      if (!start) return;
      if (event.touches.length !== 1) {
        reset();
        return;
      }
      const touch = Array.from(event.touches).find(
        (t) => t.identifier === start.id,
      );
      if (!touch) return;
      const dx = touch.clientX - start.x,
        dy = touch.clientY - start.y;
      if (!start.horizontal) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < 10) return;
        if (Math.abs(dy) > Math.abs(dx)) {
          reset();
          return;
        }
        start.horizontal = true;
      }
      if (event.cancelable) event.preventDefault();
      setDrag(dx);
    },
    end: (event) => {
      const start = gesture.current;
      if (!start) return;
      const touch = Array.from(event.changedTouches).find(
        (t) => t.identifier === start.id,
      );
      if (!touch) return;
      const dx = touch.clientX - start.x,
        dy = touch.clientY - start.y;
      if (
        Math.abs(dx) >= 50 &&
        (start.horizontal || Math.abs(dx) > Math.abs(dy) * 1.2)
      )
        swipeAway(dx, deck.current?.getBoundingClientRect().width ?? 0);
      else reset();
    },
    cancel: reset,
  };
  const behind = ordered[index + swipeStep(drag)];
  const phase = caption
    ? caption(poster)
    : poster.phase === 'pre' || !poster.period
      ? 'Pregame'
      : poster.phase === 'post'
        ? 'Final'
        : `${poster.period > 4 ? 'OT' : `Q${poster.period}`} · ${poster.clock}`;
  return (
    <section
      className="poster-stack"
      role="region"
      aria-roledescription="carousel"
      aria-label={ariaLabel}
      tabIndex={0}
      onKeyDown={(event) => {
        if (leaving || event.target !== event.currentTarget) return;
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          move(-1);
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          move(1);
        }
      }}
    >
      <div
        className="poster-stack-deck"
        ref={deck}
        onPointerDown={(event) => {
          if (
            leaving ||
            ordered.length < 2 ||
            event.pointerType !== 'pen' ||
            !event.isPrimary ||
            (event.target as Element).closest('button,a,input,select,textarea')
          )
            return;
          gesture.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
          };
        }}
        onPointerMove={(event) => {
          if (event.pointerType !== 'pen') return;
          const start = gesture.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
            reset();
            return;
          }
          if (Math.abs(dx) > 10) {
            event.currentTarget.setPointerCapture?.(event.pointerId);
            setDrag(dx);
          }
        }}
        onPointerUp={(event) => {
          if (event.pointerType !== 'pen') return;
          const start = gesture.current;
          if (!start || start.id !== event.pointerId) return;
          const dx = event.clientX - start.x,
            dy = event.clientY - start.y;
          if (Math.abs(dx) >= 50 && Math.abs(dx) > Math.abs(dy) * 1.2)
            swipeAway(dx, event.currentTarget.getBoundingClientRect().width);
          else reset();
        }}
        onPointerCancel={(event) => {
          if (event.pointerType === 'pen') reset();
        }}
        onLostPointerCapture={(event) => {
          if (
            event.pointerType === 'pen' &&
            event.target === event.currentTarget
          )
            reset();
        }}
      >
        {index + 2 < ordered.length && (
          <div className="poster-stack-back back-far" aria-hidden="true" />
        )}
        {index + 1 < ordered.length && (
          <div className="poster-stack-back back-near" aria-hidden="true" />
        )}
        {/* Keep the revealed card and its decoded image mounted when it becomes the front card. */}
        {ordered
          .filter((p) => p.id === poster.id || p.id === behind?.id)
          .map((p) => {
            const front = p.id === poster.id;
            return (
              <div
                key={p.id}
                className={
                  front
                    ? `poster-stack-front${leaving ? ' is-leaving' : drag ? ' is-dragging' : ''}`
                    : 'poster-stack-under'
                }
                aria-hidden={front ? undefined : true}
                inert={!front}
                style={{
                  transform:
                    front && drag
                      ? `translateX(${drag}px) rotate(${Math.max(-12, Math.min(12, drag / 35))}deg)`
                      : undefined,
                }}
              >
                {renderPoster(p)}
              </div>
            );
          })}
      </div>
      <div className="poster-stack-controls">
        <button
          type="button"
          className="poster-stack-arrow"
          aria-label={`Older ${itemLabel.toLowerCase()}`}
          title={`Older ${itemLabel.toLowerCase()}`}
          disabled={leaving || index === ordered.length - 1}
          onClick={() => move(1)}
        >
          <ChevronLeft size={20} />
        </button>
        <div
          className="poster-stack-caption"
          aria-live="polite"
          aria-atomic="true"
        >
          <strong>{phase}</strong>
          <span>
            {itemLabel} {index + 1} of {ordered.length}
            {index === 0 ? ' · Latest' : ''}
          </span>
        </div>
        <button
          type="button"
          className="poster-stack-arrow"
          aria-label={`Newer ${itemLabel.toLowerCase()}`}
          title={`Newer ${itemLabel.toLowerCase()}`}
          disabled={leaving || index === 0}
          onClick={() => move(-1)}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      {showSwipeHint && ordered.length > 1 && (
        <p className="poster-stack-hint">
          Swipe right for older · left for newer
        </p>
      )}
    </section>
  );
}
