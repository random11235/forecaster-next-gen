// The storage an app test starts the app on, held between the test's start and its afterEach: for screensHarness.ts
// and setupSteps.test.ts.

/** Where a test file keeps the storage its app runs on. */
export interface HeldStorage<S> {
  /** Keeps `storage`, the one the app is about to start on, and gives it back. */
  hold(storage: S): S
  /** The storage kept; a test that reads it before starting the app fails here, saying so. */
  stored(): S
  /** Closes the storage kept, if any, and lets it go. */
  close(): void
}

/** An empty holder for the storage a test file's app runs on. */
export function heldStorage<S extends { close(): void }>(): HeldStorage<S> {
  let held: S | undefined
  return {
    hold: (storage) => (held = storage),
    stored: () => {
      if (held === undefined) throw new Error('No storage yet: start the app first')
      return held
    },
    close: () => {
      held?.close()
      held = undefined
    },
  }
}
