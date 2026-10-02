import { SpinnerIcon } from './Icons';
import type { OpenPhase } from '../services/pdf/PdfBookController';

export interface LoadingScreenProps {
  phase: OpenPhase | null;
  fileName: string;
}

/**
 * The wait between "a file was chosen" and "pages are on screen".
 *
 * Reading a file is genuinely slow - a 300 MB PDF is tens of megabytes of I/O -
 * so this shows real byte progress while it happens, then names the parsing
 * phase so a long PDF.js parse does not look like a hang. It never steals focus
 * and never blocks the rest of the app from responding.
 */
const PHASE_TEXT: Record<OpenPhase['kind'], string> = {
  reading: 'Reading file',
  parsing: 'Opening document',
  measuring: 'Measuring pages',
};

export function LoadingScreen({ phase, fileName }: LoadingScreenProps) {
  const kind = phase?.kind ?? 'reading';
  const ratio = phase && phase.kind === 'reading' ? phase.ratio : null;
  const percent = ratio === null ? null : Math.round(ratio * 100);

  return (
    <div className="loading" role="status" aria-live="polite" data-phase={kind}>
      <div className="loading__panel">
        <div className="loading__spinner" aria-hidden="true">
          <SpinnerIcon width={30} height={30} />
        </div>

        <div className="loading__copy">
          <p className="loading__phase">{PHASE_TEXT[kind]}</p>
          <p className="loading__file" title={fileName}>
            {fileName}
          </p>
        </div>

        <div
          className="loading__bar"
          role="progressbar"
          aria-label="Loading document"
          aria-valuemin={0}
          aria-valuemax={100}
          // Omitting `aria-valuenow` means "indeterminate", which screen readers
          // announce as busy. A progress bar that keeps reporting 0% would be a
          // lie; a stale byte count would be worse.
          aria-valuenow={percent ?? undefined}
          aria-valuetext={percent === null ? 'Loading' : `${percent} percent`}
        >
          <span
            className="loading__bar-fill"
            data-indeterminate={percent === null ? 'true' : 'false'}
            style={percent === null ? undefined : { width: `${percent}%` }}
          />
        </div>

        <p className="loading__note">
          {percent === null ? 'Large documents can take a moment.' : `${percent}% read`}
        </p>
      </div>
    </div>
  );
}