/** An answer kept in the server's memory: given at once while it is fresh, given at once while it
 *  is stale too (a new one is fetched behind it), and only waited for the very first time. A
 *  failed fetch keeps the old answer and is tried again a minute later. Pure apart from the clock,
 *  so the tests drive it with their own. */
export function kept<T>(
  load: () => Promise<T>,
  freshFor: number,
  now: () => number = Date.now,
  retryAfter = 60_000,
): () => Promise<T> {
  let value: { data: T; until: number } | null = null;
  let loading: Promise<T> | null = null;

  const refresh = () => {
    loading ??= load()
      .then((data) => {
        value = { data, until: now() + freshFor };
        return data;
      })
      .catch((error) => {
        if (value) value.until = now() + retryAfter;
        throw error;
      })
      .finally(() => {
        loading = null;
      });
    return loading;
  };

  return async () => {
    if (!value) return refresh();
    if (now() >= value.until) refresh().catch(() => undefined);
    return value.data;
  };
}
