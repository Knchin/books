import { FitIcon, MinusIcon, PlusIcon } from '../Icons';
import { ZOOM_STEP } from '../BookReader/BookReader';

export interface ZoomControlsProps {
  zoom: number;
  min: number;
  max: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
  disabled: boolean;
}

/**
 * Zoom, as three buttons rather than a slider.
 *
 * A slider invites precision the reader does not want; these mirror the browser
 * zoom step exactly, so muscle memory from the rest of the desktop transfers
 * straight over. The percentage doubles as the reset button, which is the
 * convention every document reader uses.
 */
export function ZoomControls({
  zoom,
  min,
  max,
  onZoomIn,
  onZoomOut,
  onZoomReset,
  disabled,
}: ZoomControlsProps) {
  const percent = Math.round(zoom * 100);
  const atMin = zoom <= min + 0.001;
  const atMax = zoom >= max - 0.001;

  return (
    <div className="zoom-controls" role="group" aria-label="Zoom">
      <button
        type="button"
        className="icon-button"
        onClick={onZoomOut}
        disabled={disabled || atMin}
        aria-label={`Zoom out (currently ${percent}%)`}
        title="Zoom out (Ctrl -)"
      >
        <MinusIcon />
      </button>

      <button
        type="button"
        className="zoom-controls__value"
        onClick={onZoomReset}
        disabled={disabled}
        aria-label={`Zoom ${percent} percent. Activate to reset to fit the page.`}
        title="Reset zoom (Ctrl 0)"
      >
        {atMin ? <FitIcon width={15} height={15} /> : null}
        <span>{percent}%</span>
      </button>

      <button
        type="button"
        className="icon-button"
        onClick={onZoomIn}
        disabled={disabled || atMax}
        aria-label={`Zoom in (currently ${percent}%)`}
        title="Zoom in (Ctrl +)"
      >
        <PlusIcon />
      </button>
    </div>
  );
}

export { ZOOM_STEP };