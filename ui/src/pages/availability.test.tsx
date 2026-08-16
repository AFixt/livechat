import { fireEvent, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { initI18n } from '../i18n/index.js';
import { useAvailabilityStore } from '../store/availability.js';

import { AvailabilityPage } from './availability.js';

const emit = vi.fn();

vi.mock('../services/socket.js', () => ({
  getStaffSocket: () => ({ emit }),
}));

vi.mock('../services/alert-sound.js', () => ({
  playAlertSound: vi.fn(),
  isAlertMuted: () => false,
  toggleAlertMute: () => false,
}));

const i18n = initI18n();

function renderPage(): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <AvailabilityPage />
    </I18nextProvider>,
  );
}

describe('AvailabilityPage', () => {
  afterEach(() => {
    emit.mockClear();
    useAvailabilityStore.setState({ status: 'unknown' });
  });

  it('exposes the availability heading and an Available switch in the accessibility tree', () => {
    renderPage();
    expect(screen.getByRole('heading', { name: /availability/i })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /available/i })).toBeInTheDocument();
    expect(screen.getByText(/you are away/i)).toBeInTheDocument();
  });

  it('reflects the persisted status from the store on load', () => {
    useAvailabilityStore.setState({ status: 'available' });
    renderPage();
    expect(screen.getByRole('checkbox', { name: /available/i })).toBeChecked();
    expect(screen.getByText(/you are available/i)).toBeInTheDocument();
  });

  it('emits availability:set and updates the visible status when toggled on', () => {
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: /available/i }));
    expect(emit).toHaveBeenCalledWith('availability:set', { status: 'available' });
    expect(useAvailabilityStore.getState().status).toBe('available');
    expect(screen.getByText(/you are available/i)).toBeInTheDocument();
  });

  it('emits availability:set away when toggled off', () => {
    useAvailabilityStore.setState({ status: 'available' });
    renderPage();
    fireEvent.click(screen.getByRole('checkbox', { name: /available/i }));
    expect(emit).toHaveBeenCalledWith('availability:set', { status: 'away' });
    expect(useAvailabilityStore.getState().status).toBe('away');
  });
});
