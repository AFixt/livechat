import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';

/**
 * Admin-only tenants page. List + create forms land in a later iteration.
 * @returns The page element.
 */
export function AdminTenantsPage(): React.JSX.Element {
  const { t } = useTranslation();
  return (
    <Typography component="h2" variant="h4">
      {t('nav.admin.tenants')}
    </Typography>
  );
}

export default AdminTenantsPage;
