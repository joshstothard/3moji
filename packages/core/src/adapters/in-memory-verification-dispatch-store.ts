import type {
  VerificationDispatch,
  VerificationDispatchStore,
} from "../ports/verification-dispatch-store";

export interface InMemoryVerificationDispatchStore extends VerificationDispatchStore {
  /** Everything recorded, oldest first. */
  readonly recorded: readonly VerificationDispatch[];
  clear(): void;
}

/**
 * A {@link VerificationDispatchStore} that keeps rows in an array.
 *
 * Lives in `src` rather than a test helper for the same reason
 * `createRecordingEmailSender` does: the integration suite uses it. Those tests
 * exercise real Better Auth flows against a real database, and several of them
 * want the *links* Better Auth issued without also depending on the table that
 * happens to record them.
 *
 * It honours the port's contract exactly, including the two orderings the real
 * adapter promises — `newestFor` and `findByTokenHash` both answer with the
 * newest match — because a fake that is laxer than its adapter turns a green
 * unit test into a production defect.
 */
export function createInMemoryVerificationDispatchStore(): InMemoryVerificationDispatchStore {
  const recorded: VerificationDispatch[] = [];

  const newestOf = (
    candidates: readonly VerificationDispatch[],
  ): VerificationDispatch | undefined =>
    candidates.reduce(
      (newest: VerificationDispatch | undefined, dispatch) =>
        newest === undefined ||
        dispatch.sentAt.getTime() >= newest.sentAt.getTime()
          ? dispatch
          : newest,
      undefined,
    );

  return {
    recorded,
    record: (dispatch) => {
      recorded.push(dispatch);
      return Promise.resolve();
    },
    since: (userId, since) =>
      Promise.resolve(
        recorded.filter(
          (dispatch) =>
            dispatch.userId === userId &&
            dispatch.sentAt.getTime() >= since.getTime(),
        ),
      ),
    newestFor: (userId) =>
      Promise.resolve(
        newestOf(recorded.filter((dispatch) => dispatch.userId === userId)),
      ),
    findByTokenHash: (tokenHash) =>
      Promise.resolve(
        newestOf(
          recorded.filter((dispatch) => dispatch.tokenHash === tokenHash),
        ),
      ),
    clear: () => {
      recorded.length = 0;
    },
  };
}
