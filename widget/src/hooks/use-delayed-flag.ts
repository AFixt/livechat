import { useEffect, useState } from 'preact/hooks';

/**
 * Gate a boolean so it only turns on after its source has stayed true
 * continuously for `delayMs`, and turns off again the instant the source goes
 * false (cancelling any pending delay).
 *
 * This backs the §5.1.2 proactive invitation's "after a short period" wording:
 * the widget must not swap its plain trigger for the invitation flourish the
 * very instant support comes online — it waits a beat first. Dropping the delay
 * (or the source flipping false) hides the invitation immediately.
 * @param active - The source flag (e.g. whether support is currently available).
 * @param delayMs - How long `active` must remain true before the gate opens.
 * @returns True once `active` has been continuously true for `delayMs`.
 */
export function useDelayedFlag(active: boolean, delayMs: number): boolean {
  const [on, setOn] = useState(false);

  useEffect(() => {
    if (!active) {
      setOn(false);
      return undefined;
    }
    const timer = setTimeout(() => {
      setOn(true);
    }, delayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [active, delayMs]);

  return on;
}
