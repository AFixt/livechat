import { roleSchema } from '@livechat/shared';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import TableCell from '@mui/material/TableCell';
import TableRow from '@mui/material/TableRow';
import TextField from '@mui/material/TextField';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  AdminTable,
  FormDialog,
  PageHeader,
  SelectField,
  toTenantOptions,
  toValueOptions,
  useDialogForm,
} from '../../components/admin/index.js';
import {
  useCreateInvitation,
  useInvitations,
  useRevokeInvitation,
  useTenants,
} from '../../hooks/use-admin-queries.js';

import type { AdminTableColumn } from '../../components/admin/index.js';
import type { Role } from '@livechat/shared';

const ROLE_OPTIONS = toValueOptions(roleSchema.options);

/**
 * Admin invitations page — list + create dialog + revoke action.
 * @returns The page element.
 */
export function AdminInvitationsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const invitationsQuery = useInvitations();
  const revoke = useRevokeInvitation();
  const [createOpen, setCreateOpen] = useState(false);

  const columns: AdminTableColumn[] = [
    { label: t('admin.invitations.email') },
    { label: t('admin.invitations.role') },
    { label: t('admin.invitations.tenant') },
    { label: t('admin.invitations.inviteStatus') },
    { label: t('admin.invitations.expires') },
    { label: t('admin.common.actions'), align: 'right' },
  ];

  return (
    <Stack spacing={3}>
      <PageHeader
        heading={t('admin.invitations.heading')}
        action={{
          label: t('admin.invitations.create'),
          onClick: () => {
            setCreateOpen(true);
          },
        }}
      />

      <AdminTable
        label={t('admin.invitations.heading')}
        columns={columns}
        query={invitationsQuery}
        rowKey={(inv) => inv.id}
        renderRow={(inv) => (
          <TableRow>
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
        )}
      />

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
  const mutation = useCreateInvitation();
  const tenantsQuery = useTenants();

  const form = useDialogForm({
    onClose: props.onClose,
    reset: () => {
      setEmail('');
      setRole('staff');
      setTenantId('');
      setExpiresInDays(7);
    },
  });

  const onSubmit = form.handleSubmit((handlers) => {
    const input: Parameters<typeof mutation.mutate>[0] = {
      email,
      role,
      expiresInDays,
    };
    if (tenantId !== '') input.tenantId = tenantId;
    mutation.mutate(input, handlers);
  });

  return (
    <FormDialog
      open={props.open}
      title={t('admin.invitations.create')}
      error={form.error}
      submitLabel={t('admin.common.create')}
      submitting={mutation.isPending}
      onClose={form.close}
      onSubmit={onSubmit}
    >
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
      <SelectField
        label={t('admin.invitations.role')}
        value={role}
        onChange={(value) => {
          setRole(value as Role);
        }}
        options={ROLE_OPTIONS}
      />
      <SelectField
        label={t('admin.invitations.tenant')}
        value={tenantId}
        onChange={setTenantId}
        options={toTenantOptions(tenantsQuery.data)}
        emptyLabel="— none —"
      />
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
    </FormDialog>
  );
}

export default AdminInvitationsPage;
