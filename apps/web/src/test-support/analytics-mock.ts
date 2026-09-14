/**
 * Mock for @vercel/analytics/next to support Jest testing.
 * The Analytics component is an ESM-only module that cannot be directly
 * required by Jest, so we provide a simple mock that renders nothing.
 */

export function Analytics() {
  return null;
}
