import { useEffect, useRef } from 'react';
import { AlertIcon } from './Icons';
import { errorTitle } from '../services/pdf/errors';
import type { ReaderError } from '../services/pdf/errors';

export interface ErrorNoticeProps {
  error: ReaderError;
  onRetry?: () => void;
  onDismiss?: () => void;
  onChooseAnother?: () => void;
}

/**
 * A failure the reader can act on.
 *
 * `role="alert"` because it usually replaces content the reader was looking at.
 * Focus moves to the message so a screen reader user is told what happened rather
 * than being left on an empty page.
 */
export function ErrorNotice({
  error,
  onRetry,
  onDismiss,
  onChooseAnother,
}: ErrorNoticeProps) {
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, [error]);

  return (
    <div className="error" role="alert" data-code={error.code}>
      <div className="error__panel">
        <span className="error__icon" aria-hidden="true">
          <AlertIcon width={22} height={22} />
        </span>

        <h2 className="error__title" ref={headingRef} tabIndex={-1}>
          {errorTitle(error.code)}
        </h2>
        <p className="error__message">{error.message}</p>
        {error.hint ? <p className="error__hint">{error.hint}</p> : null}

        <div className="error__actions">
          {onRetry ? (
            <button type="button" className="button button--primary" onClick={onRetry}>
              Try again
            </button>
          ) : null}
          {onChooseAnother ? (
            <button type="button" className="button" onClick={onChooseAnother}>
              Choose another PDF
            </button>
          ) : null}
          {onDismiss ? (
            <button type="button" className="button button--quiet" onClick={onDismiss}>
              Back
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}