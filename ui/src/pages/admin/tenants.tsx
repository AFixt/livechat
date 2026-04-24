import Alert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Collapse from '@mui/material/Collapse';
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

import { CreateTenantDialog } from '../../components/admin/create-tenant-dialog.js';
import { EmbedSnippet } from '../../components/admin/embed-snippet.js';
import {
  useRotateEmbedSecret,
  useSetAllowedOrigins,
  useTenants,
} from '../../hooks/use-admin-queries.js';

import type { Tenant } from '@livechat/shared';

/**
 * Super-admin tenants page — list + create + rotate secret + allowed-
 * origins + embed snippet.
 * @returns The page element.
 */
export function AdminTenantsPage(): React.JSX.Element {
  const { t } = useTranslation();
  const tenantsQuery = useTenants();
  const [createOpen, setCreateOpen] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <Stack spacing={3}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Typography component="h2" variant="h4">
          {t('admin.tenants.heading')}
        </Typography>
        <Button
          variant="contained"
          onClick={() => {
            setCreateOpen(true);
          }}
        >
          {t('admin.tenants.create')}
        </Button>
      </Box>

      {tenantsQuery.isLoading ? <Typography>{t('admin.common.loading')}</Typography> : null}
      {tenantsQuery.isError ? (
        <Alert severity="error" role="alert">
          {tenantsQuery.error.message}
        </Alert>
      ) : null}

      {tenantsQuery.data !== undefined && (
        <TableContainer component={Paper} variant="outlined">
          <Table aria-label={t('admin.tenants.heading')}>
            <TableHead>
              <TableRow>
                <TableCell>{t('admin.tenants.name')}</TableCell>
                <TableCell>{t('admin.tenants.slug')}</TableCell>
                <TableCell>{t('admin.tenants.domain')}</TableCell>
                <TableCell>{t('admin.tenants.status')}</TableCell>
                <TableCell align="right">{t('admin.common.actions')}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {tenantsQuery.data.length === 0 && (
                <TableRow>
                  <TableCell colSpan={5}>{t('admin.common.empty')}</TableCell>
                </TableRow>
              )}
              {tenantsQuery.data.map((tenant) => (
                <TenantRow
                  key={tenant.id}
                  tenant={tenant}
                  expanded={expandedId === tenant.id}
                  onToggle={() => {
                    setExpandedId((prev) => (prev === tenant.id ? null : tenant.id));
                  }}
                />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <CreateTenantDialog
        open={createOpen}
        onClose={() => {
          setCreateOpen(false);
        }}
      />
    </Stack>
  );
}

interface TenantRowProps {
  tenant: Tenant;
  expanded: boolean;
  onToggle: () => void;
}

/**
 * One tenant's row + collapsible admin surface (embed snippet, allowed
 * origins, rotate secret).
 * @param props - Row props.
 * @returns Two table rows — the primary row and the collapse row.
 */
function TenantRow(props: TenantRowProps): React.JSX.Element {
  const { t } = useTranslation();
  const rotate = useRotateEmbedSecret();
  const setOrigins = useSetAllowedOrigins();
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [originsText, setOriginsText] = useState((props.tenant.allowedOrigins ?? []).join('\n'));

  const handleRotate = (): void => {
    rotate.mutate(props.tenant.id, {
      onSuccess: (secret) => {
        setNewSecret(secret);
      },
    });
  };

  const handleSaveOrigins = (): void => {
    const origins = originsText
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    setOrigins.mutate({
      id: props.tenant.id,
      origins: origins.length > 0 ? origins : null,
    });
  };

  return (
    <>
      <TableRow>
        <TableCell>{props.tenant.name}</TableCell>
        <TableCell>
          <code>{props.tenant.slug}</code>
        </TableCell>
        <TableCell>{props.tenant.domain ?? '—'}</TableCell>
        <TableCell>{props.tenant.status}</TableCell>
        <TableCell align="right">
          <Button size="small" onClick={props.onToggle}>
            {props.expanded ? t('admin.common.cancel') : t('admin.common.edit')}
          </Button>
        </TableCell>
      </TableRow>
      <TableRow>
        <TableCell colSpan={5} sx={{ p: 0, borderBottom: props.expanded ? undefined : 'none' }}>
          <Collapse in={props.expanded} unmountOnExit>
            <Stack spacing={3} sx={{ p: 3, bgcolor: 'action.hover' }}>
              <Box>
                <Typography component="h3" variant="subtitle1" gutterBottom>
                  {t('admin.tenants.embedSnippet')}
                </Typography>
                <EmbedSnippet tenantSlug={props.tenant.slug} />
              </Box>
              <Box>
                <Typography component="h3" variant="subtitle1" gutterBottom>
                  {t('admin.tenants.allowedOrigins')}
                </Typography>
                <TextField
                  value={originsText}
                  onChange={(e) => {
                    setOriginsText(e.target.value);
                  }}
                  multiline
                  minRows={3}
                  fullWidth
                  helperText={t('admin.tenants.allowedOriginsHelp')}
                />
                <Button
                  onClick={handleSaveOrigins}
                  variant="outlined"
                  size="small"
                  sx={{ mt: 1 }}
                  disabled={setOrigins.isPending}
                >
                  {t('admin.common.save')}
                </Button>
              </Box>
              <Box>
                <Typography component="h3" variant="subtitle1" gutterBottom>
                  {t('admin.tenants.rotateSecret')}
                </Typography>
                <Button
                  onClick={handleRotate}
                  variant="outlined"
                  color="warning"
                  size="small"
                  disabled={rotate.isPending}
                >
                  {t('admin.tenants.rotateSecret')}
                </Button>
                {newSecret !== null && (
                  <Alert severity="warning" sx={{ mt: 2 }} role="alert">
                    <Typography component="p" gutterBottom>
                      {t('admin.tenants.newSecret')}
                    </Typography>
                    <Box component="pre" sx={{ m: 0, p: 1, bgcolor: 'background.paper' }}>
                      <code>{newSecret}</code>
                    </Box>
                  </Alert>
                )}
              </Box>
            </Stack>
          </Collapse>
        </TableCell>
      </TableRow>
    </>
  );
}

export default AdminTenantsPage;
