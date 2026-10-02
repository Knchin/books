import { useEffect, useRef, useState } from 'react';
import { clamp } from '../../utils/clamp';

export interface PageIndicatorProps {
  /** 1-based page currently on the left of the spread. */
  page: number;
  /** 1-based page on the right, when a spread is showing two pages. */
  secondPage: number | null;
  totalPages: number;
  onNavigate: (page: number) => void;
}

/**
 * `Page 12 / 240`, with a text field the reader can type into.
 *
 * The field is uncontrolled while focused and controlled when idle: committing on
 * every keystroke would fight the reader ("1" of "180" is a valid page), while
 * showing a stale value would lie about where they are.
 */
export function PageIndicator({
  page,
  secondPage,
  totalPages,
  onNavigate,
}: PageIndicatorProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    // Abandon any half-typed value once the reader is no longer in the field.
    if (document.activeElement !== inputRef.current) setDraft(null);
  }, [page]);

  const commit = (raw: string) => {
    const parsed = Number.parseInt(raw.replace(/[^\d]/g, ''), 10);
    setDraft(null);
    if (!Number.isFinite(parsed)) return;
    onNavigate(clamp(parsed, 1, totalPages));
  };

  const label =
    secondPage === null
      ? `Page ${page} of ${totalPages}`
      : `Pages ${page} and ${secondPage} of ${totalPages}`;

  return (
    <div className="page-indicator">
      <label className="visually-hidden" htmlFor="page-indicator-input">
        Go to page
      </label>
      <input
        id="page-indicator-input"
        ref={inputRef}
        className="page-indicator__input"
        type="text"
        inputMode="numeric"
        // `text` rather than `number`: spinners crowd a 60px-tall toolbar, and
        // `text` plus clamping gives better control over what can be typed.
        value={draft ?? String(page)}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={(event) => commit(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            commit(event.currentTarget.value);
            event.currentTarget.blur();
            return;
          }
          if (event.key === 'Escape') {
            event.preventDefault();
            setDraft(null);
            event.currentTarget.blur();
            return;
          }
          if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            // Arrow keys inside the field adjust the page instead of turning,
            // so the two behaviours never fight over the same key.
            event.preventDefault();
            event.stopPropagation();
            const step = event.key === 'ArrowUp' ? 1 : -1;
            const from = Number.parseInt(
              (draft ?? String(page)).replace(/[^\d]/g, ''),
              10,
            );
            const base = Number.isFinite(from) ? from : page;
            onNavigate(clamp(base + step, 1, totalPages));
            setDraft(null);
          }
        }}
        aria-label={`Page number, ${label}`}
        aria-describedby="page-indicator-total"
        autoComplete="off"
        spellCheck={false}
        size={3}
      />
      <span className="page-indicator__total" id="page-indicator-total" aria-hidden="true">
        / {totalPages}
      </span>
    </div>
  );
}