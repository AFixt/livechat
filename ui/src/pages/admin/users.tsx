import { roleSchema, userStatusSchema } from '@livechat/shared';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AdminTable } from '../../components/admin/admin-table.js';
import { FormDialog } from '../../components/admin/form-dialog.js';
import { PageHeader } from '../../components/admin/page-header.js';
import {
  SelectField,
  toTenantOptions,
  toValueOptions,
} from '../../components/admin/select-field.js';
import { useTenants, useUpdateUser, useUsers } from '../../hooks/use-admin-queries.js';

import type { AdminTableColumn } from '../../components/admin/admin-table.js';
import type { Role, UserSafe, UserStatus } from '@livechat/shared';

const ROLE_OPTIONS = toValueOptions(roleSchema.options);
const STATUS_OPTIONS = toValueOptions(userStatusSchema.options);

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

  const columns: AdminTableColumn[] = [
    { label: t('admin.users.email') },
    { label: t('admin.users.name') },
    { label: t('admin.users.role') },
    { label: t('admin.users.status') },
    { label: t('admin.users.tenant') },
    { label: t('admin.common.actions'), align: 'right' },
  ];

  return (
    <Stack spacing={3}>
      <PageHeader heading={t('admin.users.heading')} />

      <SelectField
        label={t('admin.users.filterByTenant')}
        value={tenantFilter}
        onChange={setTenantFilter}
        options={toTenantOptions(tenantsQuery.data)}
        emptyLabel="— all tenants —"
        maxWidth={320}
      />

      <AdminTable
        label={t('admin.users.heading')}
        columns={columns}
        query={usersQuery}
        rowKey={(user) => user.id}
        renderRow={(user) => (
          <TableRow>
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
        )}
      />

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
    <FormDialog
      open
      title={user.email}
      error={error}
      submitLabel={t('admin.common.save')}
      submitting={mutation.isPending}
      onClose={props.onClose}
      onSubmit={handleSubmit}
    >
      <SelectField
        label={t('admin.users.role')}
        value={role}
        onChange={(value) => {
          setRole(value as Role);
        }}
        options={ROLE_OPTIONS}
      />
      <SelectField
        label={t('admin.users.status')}
        value={status}
        onChange={(value) => {
          setStatus(value as UserStatus);
        }}
        options={STATUS_OPTIONS}
      />
      <Box component="p" sx={{ m: 0, color: 'text.secondary' }}>
        tenant: {user.tenantId ?? '—'}
      </Box>
    </FormDialog>
  );
}

export default AdminUsersPage;
