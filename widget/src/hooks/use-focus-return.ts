import { useEffect, useRef } from 'preact/hooks';

/**
 * When `open` becomes true, capture the element that had focus (the trigger
 * button). When `open` becomes false, return focus to it. Required for a
 * dialog-style widget to meet §5.1 accessibility expectations.
 * @param open - Whether the panel is currently open.
 */
export function useFocusReturn(open: boolean): void {
  const opener = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      opener.current =
        document.activeElement instanceof HTMLElement ? document.activeElement : null;
    } else if (opener.current !== null) {
      opener.current.focus();
      opener.current = null;
    }
  }, [open]);
}
