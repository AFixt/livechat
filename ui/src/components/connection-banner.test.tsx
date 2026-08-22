import { ThemeProvider } from '@mui/material/styles';
import { act, render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initI18n } from '../i18n/index.js';
import { useConnectionStore } from '../store/connection.js';
import { buildTheme } from '../theme/index.js';

import { ConnectionBanner } from './connection-banner.js';

const i18n = initI18n();

function renderBanner(): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <ThemeProvider theme={buildTheme('light')}>
        <ConnectionBanner />
      </ThemeProvider>
    </I18nextProvider>,
  );
}

describe('ConnectionBanner', () => {
  beforeEach(() => {
    useConnectionStore.setState({ status: 'connected' });
  });

  it('always exposes a polite status live region so changes are announced', () => {
    renderBanner();
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
  });

  it('shows nothing while connected', () => {
    renderBanner();
    expect(screen.getByRole('status')).toHaveTextContent('');
  });

  it('shows the reconnecting message when the socket drops', () => {
    useConnectionStore.setState({ status: 'reconnecting' });
    renderBanner();
    expect(screen.getByRole('status')).toHaveTextContent(/reconnecting/i);
  });

  it('shows the reconnected confirmation when the socket returns, then clears itself', () => {
    vi.useFakeTimers();
    try {
      useConnectionStore.setState({ status: 'reconnected' });
      renderBanner();
      expect(screen.getByRole('status')).toHaveTextContent(/reconnected to live updates/i);
      act(() => {
        vi.advanceTimersByTime(4000);
      });
      expect(useConnectionStore.getState().status).toBe('connected');
      expect(screen.getByRole('status')).toHaveTextContent('');
    } finally {
      vi.useRealTimers();
    }
  });
});

afterEach(() => {
  useConnectionStore.setState({ status: 'connected' });
});
