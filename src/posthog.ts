// Anonymous usage analytics (PostHog), for counts like "fishing checks run" and "offline areas saved".
// Only in production builds, so local testing isn't counted. Nothing location-related is sent: no autocapture
// (clicked text includes place names and coordinates), no session replay, and URL fragments (#map=…&pt=…, written
// by Copy link) are cut from every URL before an event leaves the browser. Events carry only names and categories.
import type { CaptureResult, PostHog } from 'posthog-js';

const posthogKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
const posthogHost = import.meta.env.VITE_POSTHOG_HOST?.trim();

export const isPostHogConfigured = import.meta.env.PROD && Boolean(posthogKey && posthogHost);

// How this visit started, read once at load (before Copy link rewrites the URL). URLs are scrubbed below, so without
// this a visit from a shared link looks like any other. Which parts the link had, never their values.
export function entryOf(hash: string) {
  const p = new URLSearchParams(hash.replace(/^#/, ''));
  const parts = ['map', 'pt', 'water', 'layers', 'mapland'].filter(k => p.has(k));
  return { entry: parts.length ? 'shared_link' : 'direct', parts };
}
const { entry: ENTRY, parts: SHARED_PARTS } = entryOf(window.location.hash);

// "https://…/ca-fishing-map/#map=37.6,-119.0,12&pt=…" -> "https://…/ca-fishing-map/" (also drops any ?query).
const stripUrl = (v: unknown) => (typeof v === 'string' && /^https?:\/\//.test(v) ? v.replace(/[?#].*$/, '') : v);
// The page URL PostHog shows (Activity's URL / Screen column): scrubbed, with #shared-link marking visits that
// started from a shared link (the marker, not the link's coordinates).
export const pageUrl = (url: string, entry: string) => `${stripUrl(url)}${entry === 'shared_link' ? '#shared-link' : ''}`;
function scrub(props?: Record<string, unknown>) {
  if (props) for (const k of Object.keys(props)) props[k] = stripUrl(props[k]);
}
const beforeSend = (event: CaptureResult | null): CaptureResult | null => {
  if (!event) return event;
  scrub(event.properties);
  if (event.properties) {
    event.properties.entry = ENTRY;
    if (typeof event.properties.$current_url === 'string') event.properties.$current_url = pageUrl(event.properties.$current_url, ENTRY);
  }
  scrub(event.$set as Record<string, unknown> | undefined);
  scrub(event.$set_once as Record<string, unknown> | undefined);
  return event;
};

// Loaded after the page is up, in its own chunk (~100 KB gzipped), so it never delays the map; events from the first
// moments are queued until then.
let client: PostHog | null = null;
const queue: [string, Record<string, unknown> | undefined][] = [];
if (isPostHogConfigured) {
  const load = () => import('posthog-js').then(({ default: posthog }) => {
    posthog.init(posthogKey!, {
      api_host: posthogHost,
      defaults: '2026-05-30',
      autocapture: false,
      capture_dead_clicks: false,
      capture_heatmaps: false,
      disable_session_recording: true,
      disable_surveys: true,
      person_profiles: 'identified_only', // anonymous events only; no person records
      before_send: beforeSend,
      capture_exceptions: {
        capture_unhandled_errors: true,
        capture_unhandled_rejections: true,
        capture_console_errors: false
      }
    });
    client = posthog;
    for (const [event, props] of queue.splice(0)) posthog.capture(event, props);
  }).catch(() => { /* blocked by an ad blocker or offline: no analytics */ });
  if (document.readyState === 'complete') setTimeout(load, 1000);
  else window.addEventListener('load', () => setTimeout(load, 1000), { once: true });
}

if (ENTRY === 'shared_link') track('shared_link_opened', { parts: SHARED_PARTS.join(','), has_point: SHARED_PARTS.includes('pt') });

// Events: a name plus categories (water type, verdict…), never locations, place names or free text.
export function track(event: string, props?: Record<string, string | number | boolean | null>) {
  if (!isPostHogConfigured) return;
  if (client) client.capture(event, props);
  else queue.push([event, props]);
}

// "Report a problem" (lib/report.ts): sent straight to PostHog's capture API, not through posthog-js, so success is
// known: ad blockers often block PostHog's requests, and then the form offers the report to copy instead. Works in
// development too (tagged env: development) so the form can be tried locally. Location fields are present only when
// the reporter chose to share them.
export async function sendReport(report: Record<string, unknown>): Promise<boolean> {
  if (!posthogKey || !posthogHost) return false;
  const shared = report.location_shared === true;
  try {
    const res = await fetch(`${posthogHost.replace(/\/$/, '')}/capture/`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: posthogKey, event: 'bug_report', distinct_id: client?.get_distinct_id() ?? 'problem-report',
        properties: { ...report, entry: ENTRY, env: import.meta.env.MODE, $current_url: shared ? window.location.href : pageUrl(window.location.href, ENTRY) }
      })
    });
    return res.ok;
  } catch { return false; }
}
