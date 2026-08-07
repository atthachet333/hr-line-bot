import { describe, it, expect, vi } from 'vitest';
import { createSingleClose } from '@/lib/liff/close-window';

describe('createSingleClose (Bug 2 — success then close)', () => {
  it('in the LINE client: closeWindow is called exactly once (double-call safe)', () => {
    const closeWindow = vi.fn();
    const onFallback = vi.fn();
    const close = createSingleClose({ isInClient: () => true, closeWindow, onFallback });
    close();
    close();
    close();
    expect(closeWindow).toHaveBeenCalledTimes(1);
    expect(onFallback).not.toHaveBeenCalled();
  });

  it('external browser: uses the fallback, never calls closeWindow', () => {
    const closeWindow = vi.fn();
    const onFallback = vi.fn();
    const close = createSingleClose({ isInClient: () => false, closeWindow, onFallback });
    close();
    expect(closeWindow).not.toHaveBeenCalled();
    expect(onFallback).toHaveBeenCalledTimes(1);
  });

  it('if closeWindow throws, the guard resets so a manual retry can still close', () => {
    let calls = 0;
    const closeWindow = vi.fn(() => {
      calls += 1;
      if (calls === 1) throw new Error('closeWindow failed');
    });
    const close = createSingleClose({ isInClient: () => true, closeWindow, onFallback: vi.fn() });
    close(); // throws internally, resets
    close(); // retries successfully
    expect(closeWindow).toHaveBeenCalledTimes(2);
  });
});
