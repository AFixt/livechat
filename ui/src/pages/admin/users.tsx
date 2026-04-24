import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

/**
 * Admin-only users page. Stub.
 * @returns The page element.
 */
export function AdminUsersPage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Typography component="h2" variant="h4">
      {t('nav.admin.users')}
    </Typography>
  );
}

export default AdminUsersPage;
