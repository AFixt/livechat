import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

import { playAlertSound } from '../services/alert-sound.js';
import { announceLiveMessage } from '../services/live-region-bus.js';
import { getStaffSocket } from '../services/socket.js';
import { useAvailabilityStore } from '../store/availability.js';

/**
 * Availability page — sets the operator's explicit per-user status
 * (available / away). The status is stored server-side (Redis), persists
 * across reconnects and reloads, and gates whether the customer widget shows
 * the proactive invitation (§5.1.2) or the no-support state (§5.1.4).
 * @returns The page element.
 */
export function AvailabilityPage(): React.JSX.Element {
  const { t } = useTranslation();
  const status = useAvailabilityStore((s) => s.status);
  const setStatus = useAvailabilityStore((s) => s.setStatus);
  const isAvailable = status === 'available';

  const handleToggle = (_event: unknown, checked: boolean): void => {
    const next = checked ? 'available' : 'away';
    getStaffSocket().emit('availability:set', { status: next });
    // Optimistic: the server echoes `availability:self`, but reflect the choice
    // immediately. Announce the change three ways per §3 — programmatic (live
    // region), visible (status text + switch), and audible (alert chime).
    setStatus(next);
    announceLiveMessage(checked ? t('availability.nowAvailable') : t('availability.nowAway'));
    playAlertSound();
  };

  return (
    <Stack spacing={3}>
      <Typography component="h2" variant="h4">
        {t('nav.availability')}
      </Typography>
      <Typography>{t('availability.intro')}</Typography>
      <FormControlLabel
        control={
          <Switch
            checked={isAvailable}
            onChange={handleToggle}
            slotProps={{ input: { 'aria-label': t('availability.available') } }}
          />
        }
        label={t('availability.available')}
      />
      <Typography aria-live="polite">
        {isAvailable ? t('availability.statusAvailable') : t('availability.statusAway')}
      </Typography>
    </Stack>
  );
}

export default AvailabilityPage;
