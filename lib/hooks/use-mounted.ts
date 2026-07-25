import { useSyncExternalStore } from 'react';

const emptySubscribe = () => () => {};

/**
 * Returns false during SSR and the first client render, true afterwards.
 * Used to guard LIFF-dependent UI without calling setState inside an effect.
 */
export function useMounted(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true, // client snapshot
    () => false, // server snapshot
  );
}
