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

import { useTenants, useUpdateUser, useUsers } from '../../hooks/use-admin-queries.js';

import type { Role, UserSafe, UserStatus } from '@livechat/shared';

const ROLES: Role[] = ['super_admin', 'admin', 'staff', 'client'];
const STATUSES: UserStatus[] = ['active', 'suspended', 'pending', 'deactivated'];

/**
 * Admin users page — list + filter-by-tenant + edit role/status dialog.
 * @returns The page element.
 */
export function AdminUsersPage(): React.JSX.Element {
  const { t } = useTranslation();
  const [tenantFilter, setTenantFilter] = useState<string>('');
  const usersQuery = useUsers(tenantFilter === '' ? undefined : tenantFilter);
  const tenantsQuery = useTenants();
  const [editing, setEditing] = useState<UserSafe | null>(null);

  return (
    <Stack spacing={3}>
      <Typography component="h2" variant="h4">
        {t('admin.users.heading')}
      </Typography>

      <TextField
        select
        label={t('admin.users.filterByTenant')}
        value={tenantFilter}
        onChange={(e) => {
          setTenantFilter(e.target.value);
        }}
        sx={{ maxWidth: 320 }}
      >
        <MenuItem value="">— all tenants —</MenuItem>
        {(tenantsQuery.data ?? []).map((tenant) => (
          <MenuItem key={tenant.id} value={tenant.id}>
            {tenant.name} ({tenant.slug})
          </MenuItem>
        ))}
      </TextField>

      {usersQuery.isLoading ? <Typography>{t('admin.common.loading')}</Typography> : null}
      {usersQuery.isError ? (
        <Alert severity="error" role="alert">
          {usersQuery.error.message}
        </Alert>
      ) : null}

      {usersQuery.data !== undefined && (
        <TableContainer component={Paper} variant="outlined">
          <Table aria-label={t('admin.users.heading')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.users.email')}</TableCell>
                <TableCell>{t('admin.users.name')}</TableCell>
                <TableCell>{t('admin.users.role')}</TableCell>
                <TableCell>{t('admin.users.status')}</TableCell>
                <TableCell>{t('admin.users.tenant')}</TableCell>
                <TableCell align="right">{t('admin.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {usersQuery.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6}>{t('admin.common.empty')}</TableCell>
                </TableRow>
              )}
              {usersQuery.data.map((user) => (
                <TableRow key={user.id}>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    {user.firstName} {user.lastName}
                  </TableCell>
                  <TableCell>{user.role}</TableCell>
                  <TableCell>{user.status}</TableCell>
                  <TableCell>{user.tenantId ?? '—'}</TableCell>
                  <TableCell align="right">
                    <Button
                      size="small"
                      onClick={() => {
                        setEditing(user);
                      }}
                    >
                      {t('admin.common.edit')}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <EditUserDialog
        user={editing}
        onClose={() => {
          setEditing(null);
        }}
      />
    </Stack>
  );
}

interface EditUserDialogProps {
  user: UserSafe | null;
  onClose: () => void;
}

/**
 * Role + status editor dialog. Open when `user` is non-null.
 * @param props - Dialog props.
 * @returns The dialog element or null.
 */
function EditUserDialog(props: EditUserDialogProps): React.JSX.Element | null {
  const { t } = useTranslation();
  const mutation = useUpdateUser();
  const [role, setRole] = useState<Role>(props.user?.role ?? 'staff');
  const [status, setStatus] = useState<UserStatus>(props.user?.status ?? 'active');
  const [error, setError] = useState<string | null>(null);

  if (props.user === null) return null;
  const user = props.user;

  const handleSubmit = (e: React.SyntheticEvent): void => {
    e.preventDefault();
    setError(null);
    mutation.mutate(
      { id: user.id, input: { role, status } },
      {
        onSuccess: () => {
          props.onClose();
        },
        onError: (err) => {
          setError(err.message || t('app.error'));
        },
      },
    );
  };

  return (
    <Dialog open onClose={props.onClose} fullWidth maxWidth="sm">
      <form onSubmit={handleSubmit}>
        <DialogTitle>{user.email}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error !== null && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}
            <TextField
              select
              label={t('admin.users.role')}
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
              label={t('admin.users.status')}
              value={status}
              onChange={(e) => {
                setStatus(e.target.value as UserStatus);
              }}
              fullWidth
            >
              {STATUSES.map((s) => (
                <MenuItem key={s} value={s}>
                  {s}
                </MenuItem>
              ))}
            </TextField>
            <Box component="p" sx={{ m: 0, color: 'text.secondary' }}>
              tenant: {user.tenantId ?? '—'}
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={props.onClose}>{t('admin.common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={mutation.isPending}>
            {t('admin.common.save')}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

export default AdminUsersPage;
