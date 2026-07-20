import Box from '@mui/material/Box';
import { useEffect, useState } from 'react';

import { subscribeLiveMessages } from '../services/live-region-bus.js';

/**
 * Visually-hidden aria-live region. Any call to {@link announceLiveMessage}
 * posts text here and screen readers announce it.
 * @returns An ARIA-live element rendered into the DOM.
 */
export function LiveRegion(): React.JSX.Element {
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
    <Box
      component="output"
      aria-live="polite"
      aria-atomic="true"
      sx={{
        position: 'absolute',
        width: '1px',
        height: '1px',
        padding: 0,
        margin: '-1px',
        overflow: 'hidden',
        clip: 'rect(0, 0, 0, 0)',
        whiteSpace: 'nowrap',
        border: 0,
      }}
    >
      {message}
    </Box>
  );
}
