import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCreateTenant } from '../../hooks/use-admin-queries.js';

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
    <Dialog open={props.open} onClose={handleClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit}>
        <DialogTitle>{t('admin.tenants.create')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error !== null && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}
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
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose}>{t('admin.common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={mutation.isPending}>
            {t('admin.common.create')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
