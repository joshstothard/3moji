/**
 * An error shaped like the one Next.js hands an error boundary (#203): a
 * message that quotes a personal value, a digest, and a stack naming a source
 * file. Each is something the error pages must never show, so each is here to
 * be searched for.
 */
export const THROWN_MESSAGE =
  "Key (email)=(someone@example.com) already exists";
export const THROWN_DIGEST = "2718281828";
export const THROWN_STACK_FRAME =
  "at HandlePage (apps/web/src/app/[handle]/page.tsx:212:5)";

export function thrownError(): Error & { digest: string } {
  const error = Object.assign(new Error(THROWN_MESSAGE), {
    digest: THROWN_DIGEST,
  });
  error.stack = `Error: ${THROWN_MESSAGE}\n    ${THROWN_STACK_FRAME}`;
  return error;
}

/** What must not appear anywhere in a rendered error page. */
export const THROWN_DETAILS: readonly string[] = [
  "someone@example.com",
  THROWN_MESSAGE,
  THROWN_DIGEST,
  "page.tsx",
];
