/**
 * A source of the current time.
 *
 * The domain never reads the system clock directly. Handle holds expire after
 * 24 hours and released Handles return to the pool after 30 days
 * ([ADR-0004](../../../../docs/adr/0004-the-handle-model.md)), and rules like
 * those are untestable if time is ambient. Tests substitute a fixed clock.
 */
export interface Clock {
  now(): Date;
}
