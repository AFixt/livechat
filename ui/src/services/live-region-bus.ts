/**
 *
 */
type Listener = (message: string) => void;

const listeners = new Set<Listener>();

/**
 * Subscribe to live-region announcements. Called by `<LiveRegion>`.
 * @param listener - Handler invoked with each message.
 * @returns Unsubscribe function.
 */
export function subscribeLiveMessages(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Announce a message to assistive tech via the aria-live region.
 * @param message - Text to announce.
 */
export function announceLiveMessage(message: string): void {
  for (const l of listeners) l(message);
}
