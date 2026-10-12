import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function TrashTalkImageViewer({
  image,
  onDismiss,
  share,
}: {
  image: { url: string; headline: string };
  onDismiss: () => void;
  share: ReactNode;
}) {
  const previousFocus = useRef(document.activeElement as HTMLElement | null);
  const swipe = useRef<{ id: number; x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const modal = dialog.current;
    modal?.showModal();
    return () => {
      modal?.close();
      document.body.style.overflow = overflow;
      previousFocus.current?.focus();
    };
  }, []);
  return createPortal(
    <dialog
      ref={dialog}
      className="trash-talk-viewer"
      aria-label="Trash Talk image"
      onPointerDown={(event) => {
        if (
          !event.isPrimary ||
          (event.target as Element).closest('button,a,input,textarea')
        ) {
          swipe.current = null;
          return;
        }
        swipe.current = {
          id: event.pointerId,
          x: event.clientX,
          y: event.clientY,
        };
        event.currentTarget.setPointerCapture?.(event.pointerId);
      }}
      onPointerUp={(event) => {
        const start = swipe.current;
        swipe.current = null;
        if (
          start?.id === event.pointerId &&
          Math.hypot(event.clientX - start.x, event.clientY - start.y) >= 50
        )
          onDismiss();
      }}
      onPointerCancel={() => {
        swipe.current = null;
      }}
      onCancel={onDismiss}
    >
      <img src={image.url} alt={image.headline} />
      <div className="trash-talk-viewer-share">{share}</div>
      <button
        type="button"
        className="trash-talk-viewer-close"
        aria-label="Close image"
        onClick={onDismiss}
        autoFocus
      >
        <X size={28} />
      </button>
    </dialog>,
    document.body,
  );
}
