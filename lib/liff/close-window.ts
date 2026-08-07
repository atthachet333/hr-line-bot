/**
 * Single-close guard for LIFF windows (pure — no `liff`/DOM import). In the LINE
 * client it calls `closeWindow()` at most once; in an external browser (where
 * closeWindow is a no-op) it runs a fallback (e.g. show a "close this page"
 * button). If closeWindow throws, the guard resets so a manual retry can close.
 */
export interface SingleCloseDeps {
  isInClient: () => boolean;
  closeWindow: () => void;
  onFallback: () => void;
}

export function createSingleClose(deps: SingleCloseDeps): () => void {
  let closed = false;
  return function close(): void {
    if (deps.isInClient()) {
      if (closed) return; // already closed once — never call twice
      closed = true;
      try {
        deps.closeWindow();
      } catch {
        closed = false; // failed — allow a manual retry via the button
      }
    } else {
      deps.onFallback();
    }
  };
}
