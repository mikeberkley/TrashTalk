import { Download, Share, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { Poster, Snapshot } from '../../../packages/contracts/src';
import { posterFile, shareImageFile } from './posterFile';
export function PosterShare({
  poster,
  game,
  imageLabel = 'poster',
  shareFooter,
  shareUrl,
  shareTitle,
  showLabel = false,
}: {
  poster: Poster;
  game: Snapshot;
  imageLabel?: string;
  shareFooter?: string;
  shareUrl?: string;
  shareTitle?: string;
  showLabel?: boolean;
}) {
  const [file, setFile] = useState<File | null>(null),
    [expanded, setExpanded] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    setFile(null);
    setMessage('');
    setExpanded(false);
    const controller = new AbortController();
    posterFile(poster, game, controller.signal, shareFooter)
      .then((f) => {
        if (!controller.signal.aborted) setFile(f);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setMessage('Image unavailable. Refresh to try again.');
      });
    return () => controller.abort();
  }, [
    poster.url,
    poster.artworkOnly,
    poster.id,
    poster.headline,
    poster.stat,
    poster.home,
    poster.away,
    game.home.abbr,
    game.away.abbr,
    shareFooter,
  ]);
  async function share() {
    if (!file) return;
    setMessage('');
    try {
      if (shareUrl) {
        if (navigator.share) {
          await navigator.share({
            title: shareTitle ?? poster.headline,
            url: shareUrl,
          });
        } else {
          await navigator.clipboard.writeText(shareUrl);
          setMessage('Game link copied');
          setExpanded(true);
        }
        return;
      }
      if (!(await shareImageFile(file))) setExpanded((v) => !v);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') return;
      setExpanded(true);
      if (shareUrl) {
        try {
          await navigator.clipboard.writeText(shareUrl);
          setMessage('Game link copied');
        } catch {
          setMessage('Copy this game link to share');
        }
      } else setMessage('Native image sharing is unavailable in this browser.');
    }
  }
  function download() {
    if (!file) return;
    const url = URL.createObjectURL(file),
      a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
    setExpanded(false);
  }
  return (
    <div className="poster-share">
      <button
        className="poster-share-trigger"
        onClick={share}
        disabled={!file}
        aria-label={`Share ${imageLabel} image`}
        title={file ? 'Share image' : message || 'Preparing image…'}
        aria-expanded={expanded}
      >
        {showLabel && <span>Share</span>}
        <Share size={22} strokeWidth={1.8} />
      </button>
      {(expanded || message) && (
        <div className="poster-share-options">
          <button
            className="poster-share-close"
            aria-label="Close image sharing"
            onClick={() => {
              setExpanded(false);
              setMessage('');
            }}
          >
            <X size={16} />
          </button>
          {message && <p role="status">{message}</p>}
          {shareUrl && (
            <input
              aria-label="Trash Talk game share link"
              value={shareUrl}
              readOnly
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
          {file && (
            <button onClick={download}>
              <Download size={16} /> Download image
            </button>
          )}
        </div>
      )}
    </div>
  );
}
