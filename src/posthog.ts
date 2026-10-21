// Anonymous usage analytics (PostHog), for counts like "fishing checks run" and "offline areas saved".
// Only in production builds, so local testing isn't counted. Nothing location-related is sent: no autocapture
// (clicked text includes place names and coordinates), no session replay, and URL fragments (#map=…&pt=…, written
// by Copy link) are cut from every URL before an event leaves the browser. Events carry only names and categories.
import type { CaptureResult, PostHog } from 'posthog-js';

const posthogKey = import.meta.env.VITE_POSTHOG_KEY?.trim();
const posthogHost = import.meta.env.VITE_POSTHOG_HOST?.trim();

export const isPostHogConfigured = import.meta.env.PROD && Boolean(posthogKey && posthogHost);

// "https://…/ca-fishing-map/#map=37.6,-119.0,12&pt=…" -> "https://…/ca-fishing-map/" (also drops any ?query).
const stripUrl = (v: unknown) => (typeof v === 'string' && /^https?:\/\//.test(v) ? v.replace(/[?#].*$/, '') : v);
function scrub(props?: Record<string, unknown>) {
  if (props) for (const k of Object.keys(props)) props[k] = stripUrl(props[k]);
}
const beforeSend = (event: CaptureResult | null): CaptureResult | null => {
  if (!event) return event;
  scrub(event.properties);
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

// Events: a name plus categories (water type, verdict…), never locations, place names or free text.
export function track(event: string, props?: Record<string, string | number | boolean | null>) {
  if (!isPostHogConfigured) return;
  if (client) client.capture(event, props);
  else queue.push([event, props]);
}
