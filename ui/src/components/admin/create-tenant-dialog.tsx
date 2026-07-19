import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateTenant } from '../../hooks/use-admin-queries.js';

import { FormDialog } from './form-dialog.js';

interface CreateTenantDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal form for creating a tenant — name + slug + optional domain.
 * @param props - Dialog open state and close handler.
 * @returns The dialog element.
 */
export function CreateTenantDialog(props: CreateTenantDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [domain, setDomain] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useCreateTenant();

  const handleClose = (): void => {
    setName('');
    setSlug('');
    setDomain('');
    setError(null);
    props.onClose();
  };

  const handleSubmit = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    setError(null);
    const input: Parameters<typeof mutation.mutate>[0] = {
      name,
      slug,
    };
    if (domain.trim() !== '') input.domain = domain.trim();
    mutation.mutate(input, {
      onSuccess: () => {
        handleClose();
      },
      onError: (err) => {
        setError(err.message || t('app.error'));
      },
    });
  };

  return (
    <FormDialog
      open={props.open}
      title={t('admin.tenants.create')}
      error={error}
      submitLabel={t('admin.common.create')}
      submitting={mutation.isPending}
      onClose={handleClose}
      onSubmit={handleSubmit}
    >
      <TextField
        label={t('admin.tenants.name')}
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
        required
        fullWidth
        autoFocus
      />
      <TextField
        label={t('admin.tenants.slug')}
        value={slug}
        onChange={(e) => {
          setSlug(e.target.value);
        }}
        required
        fullWidth
        inputMode="text"
        helperText="lowercase, alphanumeric, hyphens only"
      />
      <TextField
        label={t('admin.tenants.domain')}
        value={domain}
        onChange={(e) => {
          setDomain(e.target.value);
        }}
        fullWidth
        placeholder="example.com"
      />
    </FormDialog>
  );
}
