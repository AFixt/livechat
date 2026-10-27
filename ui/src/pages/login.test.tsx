import { QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AxiosError, AxiosHeaders } from 'axios';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import { initI18n } from '../i18n/index.js';
import { buildQueryClient } from '../services/query-client.js';

import { LoginPage } from './login.js';

const post = vi.fn();

vi.mock('../services/api.js', () => ({ getApi: () => ({ post }) }));

const i18n = initI18n();

/**
 * A rejected axios call with the given status and response body.
 * @param status - HTTP status.
 * @param data - Response body.
 * @returns The error axios would throw.
 */
function httpError(status: number, data: unknown): AxiosError {
  const config = { headers: new AxiosHeaders() };
  return new AxiosError('failed', 'ERR_BAD_REQUEST', config, null, {
    status,
    statusText: '',
    headers: {},
    config,
    data,
  });
}

/**
 * Fill in and submit the sign-in form.
 */
async function submitLogin(): Promise<void> {
  const user = userEvent.setup();
  await user.type(screen.getByLabelText(/email address/i), 'staff@example.com');
  await user.type(screen.getByLabelText(/^password/i), 'Some!Password1');
  await user.click(screen.getByRole('button', { name: /sign in/i }));
}

function renderLogin(): ReturnType<typeof render> {
  const queryClient = buildQueryClient();
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <LoginPage />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe('LoginPage', () => {
  it('exposes the sign-in heading, labelled email + password fields, submit button, and forgot-password link in the accessibility tree', () => {
    renderLogin();
    expect(screen.getByRole('heading', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/email address/i)).toBeRequired();
    expect(screen.getByLabelText(/password/i)).toBeRequired();
    expect(screen.getByRole('button', { name: /sign in/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /forgot password/i })).toBeInTheDocument();
  });

  it('forgot-password link points to /forgot-password', () => {
    renderLogin();
    const link = screen.getByRole('link', { name: /forgot password/i });
    expect(link).toHaveAttribute('href', '/forgot-password');
  });
});

describe('LoginPage — refused sign-in (#197)', () => {
  it("announces the server's reason when a 403 carries one", async () => {
    const reason = "Your organization's access is not active. Please contact your administrator.";
    post.mockRejectedValueOnce(httpError(403, { success: false, message: reason }));
    renderLogin();
    await submitLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent(reason);
  });

  it('falls back to the locked-account text when a 403 has no message', async () => {
    post.mockRejectedValueOnce(httpError(403, {}));
    renderLogin();
    await submitLogin();
    expect(await screen.findByRole('alert')).toHaveTextContent(/temporarily locked/i);
  });
});
