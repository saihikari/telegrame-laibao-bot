import assert from 'node:assert/strict';
import { createQlStatusSnapshotProvider } from './ql-status-cache';

async function testUsesCachedSnapshotBeforeTtlExpires() {
  let calls = 0;
  const provider = createQlStatusSnapshotProvider(
    async () => {
      calls += 1;
      return true;
    },
    () => 1000,
    10_000
  );

  const first = await provider.getSnapshot();
  const second = await provider.getSnapshot();

  assert.equal(first.qlApiReady, true);
  assert.equal(second.qlApiReady, true);
  assert.equal(calls, 1);
}

async function testReturnsStaleSnapshotWhileBackgroundRefreshRuns() {
  let now = 1000;
  let resolveRefresh: ((value: boolean) => void) | undefined;
  let calls = 0;
  const probe = () =>
    new Promise<boolean>((resolve) => {
      calls += 1;
      resolveRefresh = resolve;
    });

  const provider = createQlStatusSnapshotProvider(probe, () => now, 10);

  const pendingInitial = provider.getSnapshot();
  resolveRefresh?.(true);
  const first = await pendingInitial;
  assert.equal(first.qlApiReady, true);
  assert.equal(calls, 1);

  now = 2000;
  const stale = await provider.getSnapshot();
  assert.equal(stale.qlApiReady, true);
  assert.equal(calls, 2);

  const staleAgain = await provider.getSnapshot();
  assert.equal(staleAgain.qlApiReady, true);
  assert.equal(calls, 2);

  resolveRefresh?.(false);
  await Promise.resolve();

  const refreshed = await provider.getSnapshot();
  assert.equal(refreshed.qlApiReady, false);
}

async function run() {
  await testUsesCachedSnapshotBeforeTtlExpires();
  await testReturnsStaleSnapshotWhileBackgroundRefreshRuns();
  console.log('ql-status-cache tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
