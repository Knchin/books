import { useEffect, useState } from 'react';

/**
 * Subscribe to a CSS media query.
 *
 * Starts as `false` on purpose: a wrong initial guess that is corrected after
 * mount is much cheaper than reading `matchMedia` during render (which would
 * make the first paint non-deterministic).
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;

    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);

    update();

    // `addEventListener` on MediaQueryList is supported in every browser we
    // target; `addListener` exists only for very old Safari and is skipped.
    if (typeof list.addEventListener === 'function') {
      list.addEventListener('change', update);
      return () => list.removeEventListener('change', update);
    }
    return undefined;
  }, [query]);

  return matches;
}

/** True when the user has asked the OS to reduce motion. */
export function usePrefersReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** True on coarse pointers (phones, tablets) rather than mice. */
export function useIsTouchDevice(): boolean {
  return useMediaQuery('(hover: none) and (pointer: coarse)');
}