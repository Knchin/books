import { useEffect, useRef, useState } from 'react';
import { LockIcon } from './Icons';
import type { PasswordRequest } from '../types/pdf';

export interface PasswordPromptProps {
  request: PasswordRequest;
  fileName: string;
}

/**
 * Password entry for an encrypted PDF.
 *
 * Implemented as a modal dialog with focus trapped and restored, because it is
 * the one prompt the reader cannot avoid: nothing else can happen until the
 * document opens. An incorrect password re-fires the same PDF.js callback, so
 * this component just re-announces and waits - it never guesses or retries.
 */
export function PasswordPrompt({ request, fileName }: PasswordPromptProps) {
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const wasIncorrect = request.reason === 'incorrect-password';

  useEffect(() => {
    inputRef.current?.focus();
  }, [request.reason]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        request.cancel();
        return;
      }
      if (event.key !== 'Tab') return;
      // Focus trap: a modal the reader cannot leave by keyboard would strand
      // them in a dialog whose only purpose they cannot complete.
      const root = dialogRef.current;
      if (!root) return;
      const focusable = root.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])',
      );
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [request]);

  const submit = () => {
    if (!password || submitting) return;
    setSubmitting(true);
    // PDF.js resumes parsing inside `updatePassword`. If the password is wrong
    // it calls `onPassword` again with `incorrect-password`, which re-renders
    // this component with a fresh `request`.
    request.submit(password);
  };

  return (
    <div className="modal-backdrop">
      <div
        ref={dialogRef}
        className="password"
        role="dialog"
        aria-modal="true"
        aria-labelledby="password-title"
        aria-describedby="password-description"
      >
        <span className="password__icon" aria-hidden="true">
          <LockIcon width={22} height={22} />
        </span>

        <h2 className="password__title" id="password-title">
          This document is password protected
        </h2>
        <p className="password__description" id="password-description">
          <span className="password__file" title={fileName}>
            {fileName}
          </span>
          {wasIncorrect
            ? ' That password was not accepted. Please try again.'
            : ' Enter its password to continue reading.'}
        </p>

        <form
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="password__field">
            <input
              ref={inputRef}
              type={visible ? 'text' : 'password'}
              className="input"
              value={password}
              onChange={(event) => {
                setPassword(event.target.value);
                setSubmitting(false);
              }}
              aria-label="Document password"
              aria-invalid={wasIncorrect ? 'true' : undefined}
              autoComplete="off"
              autoFocus
              spellCheck={false}
              disabled={submitting}
            />
            <button
              type="button"
              className="button button--quiet password__reveal"
              onClick={() => setVisible((value) => !value)}
              aria-pressed={visible}
              aria-label={visible ? 'Hide password' : 'Show password'}
            >
              {visible ? 'Hide' : 'Show'}
            </button>
          </div>

          <div className="password__actions">
            <button
              type="button"
              className="button button--quiet"
              onClick={() => request.cancel()}
              disabled={submitting}
            >
              Cancel
            </button>
            <button type="submit" className="button button--primary" disabled={!password || submitting}>
              {submitting ? 'Unlocking...' : 'Unlock'}
            </button>
          </div>
        </form>

        <p className="visually-hidden" role="alert">
          {wasIncorrect ? 'Incorrect password.' : ''}
        </p>
      </div>
    </div>
  );
}