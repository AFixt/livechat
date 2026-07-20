import { useEffect, useState } from 'preact/hooks';

import { subscribeLiveMessages } from '../services/live-region.js';

/**
 * Shadow-scoped aria-live region. Any module inside the widget can call
 * {@link announceLiveMessage} and the text lands here for screen readers.
 * @returns An ARIA-live output element.
 */
export function LiveRegion(): preact.JSX.Element {
  const [message, setMessage] = useState('');

  useEffect(
    () =>
      subscribeLiveMessages((msg) => {
        setMessage('');
        window.setTimeout(() => {
          setMessage(msg);
        }, 50);
      }),
    [],
  );

  return (
    <output class="sr-only" aria-live="polite" aria-atomic="true">
      {message}
    </output>
  );
}
