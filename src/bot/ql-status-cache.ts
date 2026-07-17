export interface QlStatusSnapshot {
  qlApiReady: boolean;
  updatedAt: number;
}

type ProbeFn = () => Promise<boolean>;
type NowFn = () => number;

export function createQlStatusSnapshotProvider(
  probe: ProbeFn,
  now: NowFn = () => Date.now(),
  ttlMs = 15_000
) {
  let snapshot: QlStatusSnapshot | null = null;
  let refreshPromise: Promise<void> | null = null;

  const refresh = async () => {
    try {
      const qlApiReady = await probe();
      snapshot = {
        qlApiReady,
        updatedAt: now(),
      };
    } catch {
      snapshot = {
        qlApiReady: false,
        updatedAt: now(),
      };
    }
  };

  const ensureFresh = async () => {
    if (refreshPromise) return refreshPromise;
    refreshPromise = refresh().finally(() => {
      refreshPromise = null;
    });
    return refreshPromise;
  };

  return {
    async getSnapshot(): Promise<QlStatusSnapshot> {
      const currentTime = now();
      if (!snapshot) {
        await ensureFresh();
        return snapshot || { qlApiReady: false, updatedAt: currentTime };
      }

      if (currentTime - snapshot.updatedAt > ttlMs) {
        void ensureFresh();
      }

      return snapshot;
    },
  };
}
