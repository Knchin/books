import { useEffect, useRef, type RefObject } from 'react';
import { CheckIconPlaceholder } from './SettingsBits';

export interface SettingsMenuProps {
  layout: 'auto' | 'spread' | 'single';
  /**
   * The button that opened this popover. Presses on it are not treated as
   * outside clicks: the document-level `pointerdown` handler would close the
   * menu a moment before the button's own `click` toggled it straight back
   * open, so the menu would appear to ignore the button entirely.
   */
  anchorRef: RefObject<HTMLButtonElement | null>;
  spreadMode: 'book' | 'pair';
  autoHideToolbar: boolean;
  onLayoutChange: (layout: 'auto' | 'spread' | 'single') => void;
  onSpreadModeChange: (mode: 'book' | 'pair') => void;
  onAutoHideChange: (enabled: boolean) => void;
  onClose: () => void;
}

interface RadioRowProps<T extends string> {
  name: string;
  value: T;
  current: T;
  label: string;
  hint: string;
  onSelect: (value: T) => void;
}

function RadioRow<T extends string>({
  name,
  value,
  current,
  label,
  hint,
  onSelect,
}: RadioRowProps<T>) {
  const checked = value === current;
  return (
    <label className="settings__option" data-checked={checked}>
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        onChange={() => onSelect(value)}
      />
      <span className="settings__option-mark" aria-hidden="true">
        <CheckIconPlaceholder />
      </span>
      <span className="settings__option-text">
        <span className="settings__option-label">{label}</span>
        <span className="settings__option-hint">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Reading preferences.
 *
 * A popover rather than a modal: the reader must be able to see the effect of
 * "two page" or "consecutive pairs" without closing anything. Escape closes it,
 * focus returns to the trigger, and clicks outside dismiss it.
 */
export function SettingsMenu({
  layout,
  spreadMode,
  autoHideToolbar,
  anchorRef,
  onLayoutChange,
  onSpreadModeChange,
  onAutoHideChange,
  onClose,
}: SettingsMenuProps) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Move focus into the popover so keyboard readers land on the first option
  // rather than staying behind it on the toolbar.
  useEffect(() => {
    rootRef.current?.querySelector<HTMLElement>('input, button')?.focus();
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
      }
    };
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (rootRef.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onClose();
    };
    document.addEventListener('keydown', onKeyDown, true);
    // `pointerdown` rather than `click`: dismissing on press matches how every
    // other popover behaves and avoids the "menu closed then button clicked"
    // ghost event.
    document.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={rootRef}
      className="settings"
      role="dialog"
      aria-label="Reading settings"
      data-no-gesture="true"
    >
      <section className="settings__group">
        <h2 className="settings__title" id="settings-layout">
          Page layout
        </h2>
        <div role="radiogroup" aria-labelledby="settings-layout">
          <RadioRow
            name="reader-layout"
            value="auto"
            current={layout}
            label="Automatic"
            hint="Two pages when there is room, one on a phone."
            onSelect={onLayoutChange}
          />
          <RadioRow
            name="reader-layout"
            value="spread"
            current={layout}
            label="Two page"
            hint="Always show a facing spread."
            onSelect={onLayoutChange}
          />
          <RadioRow
            name="reader-layout"
            value="single"
            current={layout}
            label="One page"
            hint="One page at a time, like a phone reader."
            onSelect={onLayoutChange}
          />
        </div>
      </section>

      <section className="settings__group">
        <h2 className="settings__title" id="settings-spreads">
          Page pairing
        </h2>
        <div role="radiogroup" aria-labelledby="settings-spreads">
          <RadioRow
            name="reader-spread"
            value="book"
            current={spreadMode}
            label="As a printed book"
            hint="Page 1 is the cover, then pages pair 2-3, 4-5, 6-7."
            onSelect={onSpreadModeChange}
          />
          <RadioRow
            name="reader-spread"
            value="pair"
            current={spreadMode}
            label="Consecutive pairs"
            hint="Pages pair 1-2, 3-4, 5-6."
            onSelect={onSpreadModeChange}
          />
        </div>
      </section>

      <section className="settings__group">
        <h2 className="settings__title" id="settings-toolbar">
          Toolbar
        </h2>
        <label className="settings__option" data-checked={autoHideToolbar}>
          <input
            type="checkbox"
            checked={autoHideToolbar}
            onChange={(event) => onAutoHideChange(event.target.checked)}
            aria-labelledby="settings-toolbar"
          />
          <span className="settings__option-mark" aria-hidden="true">
            <CheckIconPlaceholder />
          </span>
          <span className="settings__option-text">
            <span className="settings__option-label">Hide while reading</span>
            <span className="settings__option-hint">
              Move the mouse or touch to bring it back.
            </span>
          </span>
        </label>
      </section>
    </div>
  );
}