/**
 * Mock for @vercel/analytics/next to support Jest testing.
 *
 * The Analytics component is an ESM-only module that cannot be directly
 * required by Jest, so this renders nothing. It records the props it was
 * rendered with, so a test can assert that `beforeSend` is the redaction that
 * keeps reset tokens out of the analytics data (PR #238).
 */

export interface CapturedAnalyticsProps {
  readonly beforeSend?: unknown;
}

const rendered: CapturedAnalyticsProps[] = [];

export function Analytics(props: CapturedAnalyticsProps): null {
  rendered.push(props);
  return null;
}

export function renderedAnalyticsProps(): readonly CapturedAnalyticsProps[] {
  return rendered;
}

export function resetRenderedAnalyticsProps(): void {
  rendered.length = 0;
}
