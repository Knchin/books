/** `Element.closest` narrowed to elements, with a null-safe fallback. */
export function closestElement(target: EventTarget | null, selector: string): Element | null {
  if (!(target instanceof Element)) return null;
  return target.closest(selector);
}

/** True when focus currently sits inside a text entry, so shortcuts stand down. */
export function isTextEntryFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

/** Focus an element without scrolling the page around. */
export function focusSilently(el: HTMLElement | null): void {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    el.focus();
  }
}

/**
 * Rough device capability signal used to size the render budget.
 * `navigator.deviceMemory` is Chromium-only, so every access is guarded.
 */
export function estimateDeviceMemoryGb(): number {
  const nav = navigator as Navigator & { deviceMemory?: number };
  const declared = typeof nav.deviceMemory === 'number' ? nav.deviceMemory : undefined;
  if (declared && declared > 0) return declared;
  const cores = navigator.hardwareConcurrency || 4;
  return cores >= 8 ? 8 : cores >= 4 ? 4 : 2;
}
