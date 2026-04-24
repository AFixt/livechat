import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import MenuItem from '@mui/material/MenuItem';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import Table from '@mui/material/Table';
import TableBody from '@mui/material/TableBody';
import TableCell from '@mui/material/TableCell';
import TableContainer from '@mui/material/TableContainer';
import TableHead from '@mui/material/TableHead';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  useCreateInvitation,
  useInvitations,
  useRevokeInvitation,
  useTenants,
} from '../../hooks/use-admin-queries.js';

import type { Role } from '@livechat/shared';

const ROLES: Role[] = ['super_admin', 'admin', 'staff', 'client'];

/**
 * Admin invitations page — list + create dialog + revoke action.
 * @returns The page element.
 */
export function AdminInvitationsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const invitationsQuery = useInvitations();
  const revoke = useRevokeInvitation();
  const [createOpen, setCreateOpen] = useState(false);

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography component="h2" variant="h4">
          {t('admin.invitations.heading')}
        </Typography>
        <Button
          variant="contained"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          {t('admin.invitations.create')}
        </Button>
      </Box>

      {invitationsQuery.isLoading ? <Typography>{t('admin.common.loading')}</Typography> : null}
      {invitationsQuery.isError ? (
        <Alert severity="error" role="alert">
          {invitationsQuery.error.message}
        </Alert>
      ) : null}

      {invitationsQuery.data !== undefined && (
        <TableContainer component={Paper} variant="outlined">
          <Table aria-label={t('admin.invitations.heading')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.invitations.email')}</TableCell>
                <TableCell>{t('admin.invitations.role')}</TableCell>
                <TableCell>{t('admin.invitations.tenant')}</TableCell>
                <TableCell>{t('admin.invitations.inviteStatus')}</TableCell>
                <TableCell>{t('admin.invitations.expires')}</TableCell>
                <TableCell align="right">{t('admin.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {invitationsQuery.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>{t('admin.common.empty')}</TableCell>
                </TableRow>
              )}
              {invitationsQuery.data.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell>{inv.email}</TableCell>
                  <TableCell>{inv.role}</TableCell>
                  <TableCell>{inv.tenantId ?? '—'}</TableCell>
                  <TableCell>{inv.status}</TableCell>
                  <TableCell>{new Date(inv.expiresAt).toLocaleString()}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      color="warning"
                      disabled={inv.status !== 'pending' || revoke.isPending}
                      onClick={() => {
                        revoke.mutate(inv.id);
                      }}
                    >
                      {t('admin.invitations.revoke')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <CreateInvitationDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
      />
    </Stack>
  );
}

interface CreateInvitationDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal form for issuing a new invitation (email + role + tenant + expiry).
 * @param props - Dialog props.
 * @returns The dialog element.
 */
function CreateInvitationDialog(props: CreateInvitationDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<Role>('staff');
  const [tenantId, setTenantId] = useState<string>('');
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [error, setError] = useState<string | null>(null);
  const mutation = useCreateInvitation();
  const tenantsQuery = useTenants();

  const reset = (): void => {
    setEmail('');
    setRole('staff');
    setTenantId('');
    setExpiresInDays(7);
    setError(null);
  };

  const handleClose = (): void => {
    reset();
    props.onClose();
  };

  const handleSubmit = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    setError(null);
    const input: Parameters<typeof mutation.mutate>[0] = {
      email,
      role,
      expiresInDays,
    };
    if (tenantId !== '') input.tenantId = tenantId;
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
        <DialogTitle>{t('admin.invitations.create')}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error !== null && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}
            <TextField
              label={t('admin.invitations.email')}
              type="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
              }}
              required
              fullWidth
              autoFocus
            />
            <TextField
              select
              label={t('admin.invitations.role')}
              value={role}
              onChange={(e) => {
                setRole(e.target.value as Role);
              }}
              fullWidth
            >
              {ROLES.map((r) => (
                <MenuItem key={r} value={r}>
                  {r}
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              label={t('admin.invitations.tenant')}
              value={tenantId}
              onChange={(e) => {
                setTenantId(e.target.value);
              }}
              fullWidth
            >
              <MenuItem value="">— none —</MenuItem>
              {(tenantsQuery.data ?? []).map((tenant) => (
                <MenuItem key={tenant.id} value={tenant.id}>
                  {tenant.name} ({tenant.slug})
                </MenuItem>
              ))}
            </TextField>
            <TextField
              label={t('admin.invitations.expiresInDays')}
              type="number"
              value={expiresInDays}
              onChange={(e) => {
                setExpiresInDays(Number(e.target.value));
              }}
              slotProps={{ htmlInput: { min: 1, max: 30 } }}
              fullWidth
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

export default AdminInvitationsPage;
