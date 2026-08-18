import Box from '@mui/material/Box';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import { useConnectionStore } from '../store/connection.js';

/** How long the "reconnected" confirmation stays up before the banner clears. */
const RECONNECTED_LINGER_MS = 4000;

/**
 * Visible + programmatic connection-status banner for the console (issue #69,
 * AC6/§3). Mirrors the widget's reconnect banner: it shows "Connection lost.
 * Reconnecting…" while the staff socket is down and a transient "Reconnected"
 * confirmation when it returns.
 *
 * The banner is *itself* the live region (`role="status"` ⇒ `aria-live=polite`)
 * and is always mounted so screen readers announce each status change as its
 * text updates. Because the announcement rides on this element, the socket hook
 * must NOT also push the same text through the global live region — that would
 * double-announce (the mistake fixed for the widget banner). When connected the
 * region is present but empty, so nothing is shown or announced.
 * @returns The always-mounted status region.
 */
export function ConnectionBanner(): React.JSX.Element {
  const { t } = useTranslation();
  const status = useConnectionStore((s) => s.status);
  const setStatus = useConnectionStore((s) => s.setStatus);

  useEffect(() => {
    if (status !== 'reconnected') return undefined;
    const timer = window.setTimeout(() => {
      setStatus('connected');
    }, RECONNECTED_LINGER_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [status, setStatus]);

  const message =
    status === 'reconnecting'
      ? t('dashboard.connection.reconnecting')
      : status === 'reconnected'
        ? t('dashboard.connection.reconnected')
        : '';

  return (
    <Box role="status" aria-live="polite" aria-atomic="true">
      {status !== 'connected' && (
        <Box
          sx={{
            px: 2,
            py: 1,
            borderRadius: 1,
            fontWeight: 600,
            bgcolor: status === 'reconnecting' ? 'warning.main' : 'success.main',
            color: status === 'reconnecting' ? 'warning.contrastText' : 'success.contrastText',
          }}
        >
          {message}
        </Box>
      )}
    </Box>
  );
}
