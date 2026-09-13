/**
 * Give Next.js's request storage the `AsyncLocalStorage` its server provides.
 *
 * `next start` and `next dev` put Node's `AsyncLocalStorage` on `globalThis`
 * before any app code loads; Next.js's storage modules read it from there once,
 * at import. Jest does not, so without this the store falls back to a stub
 * whose `run` throws. Import this module **before** anything that imports
 * `next/dist/server/app-render/work-unit-async-storage.external`, in suites
 * that run code inside a real request store (#155).
 */
import { AsyncLocalStorage } from "node:async_hooks";

Object.assign(globalThis, { AsyncLocalStorage });
