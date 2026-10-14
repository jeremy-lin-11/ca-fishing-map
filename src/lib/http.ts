// Single fetch entry point so tests (and non-browser runtimes) can swap the transport.
export interface HttpResponse { json(): Promise<any> }
export type Http = (url: string, init?: { method?: string; body?: URLSearchParams }) => Promise<HttpResponse>;

let impl: Http = (url, init) => fetch(url, init);
export const http: Http = (url, init) => impl(url, init);
export function setHttp(fn: Http) { impl = fn; }
