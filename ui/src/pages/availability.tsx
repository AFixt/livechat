import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Switch from '@mui/material/Switch';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { isAlertMuted, toggleAlertMute } from '../services/alert-sound.js';
import { announceLiveMessage } from '../services/live-region-bus.js';

/**
 * Availability + preferences page — toggles the alert sound mute state.
 * @returns The page element.
 */
export function AvailabilityPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [muted, setMuted] = useState(isAlertMuted());

  const handleToggle = (): void => {
    const next = toggleAlertMute();
    setMuted(next);
    announceLiveMessage(next ? t('alerts.soundMuted') : t('alerts.soundUnmuted'));
  };

  return (
    <Stack spacing={3}>
      <Typography component="h2" variant="h4">
        {t('nav.availability')}
      </Typography>
      <FormControlLabel
        control={
          <Switch
            checked={muted}
            onChange={handleToggle}
            slotProps={{ input: { 'aria-label': t('alerts.soundMuted') } }}
          />
        }
        label={muted ? t('alerts.soundMuted') : t('alerts.soundUnmuted')}
      />
    </Stack>
  );
}

export default AvailabilityPage;
