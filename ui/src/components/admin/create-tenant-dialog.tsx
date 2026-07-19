import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateTenant } from '../../hooks/use-admin-queries.js';

import { FormDialog } from './form-dialog.js';
import { useDialogForm } from './use-dialog-form.js';

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
  const mutation = useCreateTenant();

  const form = useDialogForm({
    onClose: props.onClose,
    reset: () => {
      setName('');
      setSlug('');
      setDomain('');
    },
  });

  const onSubmit = form.handleSubmit((handlers) => {
    const input: Parameters<typeof mutation.mutate>[0] = {
      name,
      slug,
    };
    if (domain.trim() !== '') input.domain = domain.trim();
    mutation.mutate(input, handlers);
  });

  return (
    <FormDialog
      open={props.open}
      title={t('admin.tenants.create')}
      error={form.error}
      submitLabel={t('admin.common.create')}
      submitting={mutation.isPending}
      onClose={form.close}
      onSubmit={onSubmit}
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
