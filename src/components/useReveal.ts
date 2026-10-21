import { useEffect, useRef } from 'react';

// Results, progress and errors sit below the search form and offline areas, out of sight without scrolling.
// Scroll them into view when a search starts or an error appears.
export function useReveal(loading: boolean, error: string | null) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (loading || error) ref.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [loading, error]);
  return ref;
}
