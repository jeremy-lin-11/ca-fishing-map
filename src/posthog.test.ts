// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { entryOf, pageUrl } from './posthog';

describe('visit entry', () => {
  it('names which parts a shared link had, never their values', () => {
    expect(entryOf('#map=38.7517,-121.5912,11&pt=38.84826,-121.66397')).toEqual({ entry: 'shared_link', parts: ['map', 'pt'] });
    expect(entryOf('#layers=+rca')).toEqual({ entry: 'shared_link', parts: ['layers'] });
    expect(entryOf('')).toEqual({ entry: 'direct', parts: [] });
    expect(entryOf('#something-else')).toEqual({ entry: 'direct', parts: [] });
  });
  it('shows shared-link visits in the page URL with a marker, not the coordinates', () => {
    const u = 'https://jeremy-lin-11.github.io/ca-fishing-map/#map=38.7517,-121.5912,11&pt=38.84826,-121.66397';
    expect(pageUrl(u, 'shared_link')).toBe('https://jeremy-lin-11.github.io/ca-fishing-map/#shared-link');
    expect(pageUrl(u, 'direct')).toBe('https://jeremy-lin-11.github.io/ca-fishing-map/');
  });
});
