import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

/**
 * Admin-only invitations page. Stub.
 * @returns The page element.
 */
export function AdminInvitationsPage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Typography component="h2" variant="h4">
      {t('nav.admin.invitations')}
    </Typography>
  );
}

export default AdminInvitationsPage;
