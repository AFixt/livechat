import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { initI18n } from '../i18n/index.js';
import { useChatsStore } from '../store/chats.js';

import { DashboardPage } from './dashboard.js';

const revokeVisitorSession = vi.fn();

vi.mock('../services/visitors-api.js', () => ({
  revokeVisitorSession: (id: string) => revokeVisitorSession(id) as Promise<void>,
}));

vi.mock('../services/socket.js', () => ({
  getStaffSocket: () => ({ emit: vi.fn(), on: vi.fn(), off: vi.fn() }),
}));

vi.mock('../hooks/use-staff-socket.js', () => ({ useStaffSocket: () => undefined }));

vi.mock('../hooks/use-chat-inbox.js', () => ({
  useChatInbox: () => ({ selectChat: vi.fn(), initiateChatWithVisitor: vi.fn() }),
}));

const i18n = initI18n();

const VISITOR_ID = 'abcd1234-0000-4000-8000-000000000001';

/**
 * Render the dashboard inside the i18n provider.
 * @returns The render result.
 */
function renderPage(): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <DashboardPage />
    </I18nextProvider>,
  );
}

describe('DashboardPage — ending a visitor session (#123)', () => {
  beforeEach(() => {
    revokeVisitorSession.mockResolvedValue(undefined);
    useChatsStore.setState({
      visitors: {
        [VISITOR_ID]: {
          visitorSessionId: VISITOR_ID,
          tenantId: 'tenant-1',
          currentUrl: 'https://acme.test/pricing',
        },
      },
      chats: {},
      activeChatId: null,
    });
  });

  afterEach(() => {
    revokeVisitorSession.mockReset();
  });

  it('exposes the end-session control in the accessibility tree, named for its visitor', () => {
    renderPage();
    expect(
      screen.getByRole('button', { name: /end the session for visitor abcd1234/i }),
    ).toBeInTheDocument();
  });

  it('keeps the two row controls as siblings, not nested buttons', () => {
    renderPage();
    const startChat = screen.getByRole('button', { name: /start a chat with visitor abcd1234/i });
    const endSession = screen.getByRole('button', {
      name: /end the session for visitor abcd1234/i,
    });

    // A button inside a button is invalid HTML and leaves the inner control
    // unreachable for keyboard and AT users — the reason this row uses
    // ListItem + secondaryAction rather than putting both inside ListItemButton.
    expect(startChat.contains(endSession)).toBe(false);
    expect(endSession.contains(startChat)).toBe(false);
  });

  it('revokes the session and drops the visitor from the list', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /end the session for visitor abcd1234/i }));

    expect(revokeVisitorSession).toHaveBeenCalledWith(VISITOR_ID);
    await waitFor(() => {
      expect(
        screen.queryByRole('button', { name: /end the session for visitor abcd1234/i }),
      ).not.toBeInTheDocument();
    });
  });

  it('announces the outcome, because the row simply disappearing is not perceivable', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /end the session for visitor abcd1234/i }));

    await waitFor(() => {
      expect(screen.getByRole('status', { name: /visitor session updates/i })).toHaveTextContent(
        /session ended for visitor abcd1234/i,
      );
    });
  });

  it('announces a failure and keeps the visitor listed', async () => {
    revokeVisitorSession.mockRejectedValue(new Error('nope'));
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole('button', { name: /end the session for visitor abcd1234/i }));

    await waitFor(() => {
      expect(screen.getByRole('status', { name: /visitor session updates/i })).toHaveTextContent(
        /could not end the session/i,
      );
    });
    // A failed revocation must not look like a successful one.
    expect(
      screen.getByRole('button', { name: /end the session for visitor abcd1234/i }),
    ).toBeInTheDocument();
  });
});
