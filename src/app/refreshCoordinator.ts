export function createRefreshCoordinator(
  run: (refreshProviders: boolean) => Promise<void>,
): (refreshProviders: boolean) => Promise<void> {
  let inFlight: Promise<void> | null = null;
  let forcedRefreshPending = false;

  return (refreshProviders: boolean): Promise<void> => {
    if (inFlight) {
      if (refreshProviders) {
        forcedRefreshPending = true;
      }
      return inFlight;
    }

    inFlight = (async () => {
      let forceProviders = refreshProviders;
      let firstError: unknown;
      do {
        forcedRefreshPending = false;
        try {
          await run(forceProviders);
        } catch (error) {
          firstError ??= error;
        }
        forceProviders = forcedRefreshPending;
      } while (forceProviders);
      if (firstError !== undefined) {
        throw firstError;
      }
    })().finally(() => {
      inFlight = null;
    });
    return inFlight;
  };
}
