import TextField from '@mui/material/TextField';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { initI18n } from '../../i18n/index.js';

import { FormDialog } from './form-dialog.js';

const i18n = initI18n();

interface Overrides {
  error?: string | null;
  submitting?: boolean;
  onClose?: () => void;
  onSubmit?: (event: React.SyntheticEvent) => void;
}

function renderDialog(overrides: Overrides = {}): ReturnType<typeof render> {
  return render(
    <I18nextProvider i18n={i18n}>
      <FormDialog
        open
        title="Create tenant"
        error={overrides.error ?? null}
        submitLabel="Create"
        submitting={overrides.submitting ?? false}
        onClose={overrides.onClose ?? ((): void => undefined)}
        onSubmit={
          overrides.onSubmit ??
          ((e): void => {
            e.preventDefault();
          })
        }
      >
        <TextField label="Name" />
      </FormDialog>
    </I18nextProvider>,
  );
}

describe('FormDialog', () => {
  it('exposes the dialog with its title, fields, and both actions', () => {
    renderDialog();
    expect(screen.getByRole('dialog', { name: 'Create tenant' })).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create' })).toBeInTheDocument();
  });

  it('renders no alert when there is no error', () => {
    renderDialog();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('announces the error through an alert when one is present', () => {
    renderDialog({ error: 'Slug already taken' });
    expect(screen.getByRole('alert')).toHaveTextContent('Slug already taken');
  });

  it('disables only the submit button while submitting', () => {
    renderDialog({ submitting: true });
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeEnabled();
  });

  it('calls onClose when cancel is activated', async () => {
    const onClose = vi.fn();
    renderDialog({ onClose });
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('submits the form when the submit button is activated', async () => {
    const onSubmit = vi.fn((e: React.SyntheticEvent) => {
      e.preventDefault();
    });
    renderDialog({ onSubmit });
    await userEvent.click(screen.getByRole('button', { name: 'Create' }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
