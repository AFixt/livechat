import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { initI18n } from '../i18n/index.js';

import { PreferencesPage } from './preferences.js';

const toggleAlertMute = vi.fn(() => true);

vi.mock('../services/alert-sound.js', () => ({
  playAlertSound: vi.fn(),
  isAlertMuted: () => false,
  toggleAlertMute: () => toggleAlertMute(),
}));

const i18n = initI18n();

function renderPage(): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <PreferencesPage />
    </I18nextProvider>,
  );
}

describe('PreferencesPage', () => {
  it('exposes the Preferences heading and the alert-sound mute switch in the accessibility tree', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /preferences/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /alert sound muted/i })).toBeInTheDocument();
  });

  it('toggles the alert-sound mute preference when the switch is activated', () => {
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: /alert sound muted/i }));
    expect(toggleAlertMute).toHaveBeenCalledTimes(1);
  });
});
