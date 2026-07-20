import AppBar from '@mui/material/AppBar';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Container from '@mui/material/Container';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import { Link as RouterLink, Outlet, useNavigate } from 'react-router-dom';

import { getApi } from '../services/api.js';
import { disconnectStaffSocket } from '../services/socket.js';
import { useAuthStore } from '../store/auth.js';

/**
 * Main application shell — top nav + `<Outlet>` for routed page content.
 * @returns The layout element.
 */
export function AppShell(): React.JSX.Element {
  const { t } = useTranslation();
  const clear = useAuthStore((s) => s.clear);
  const user = useAuthStore((s) => s.user);
  const navigate = useNavigate();

  const handleLogout = async (): Promise<void> => {
    try {
      await getApi().post('/auth/logout');
    } catch {
      // ignore — always clear client state
    }
    disconnectStaffSocket();
    clear();
    await navigate('/login');
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <AppBar position="sticky" color="default" elevation={0}>
        <Toolbar>
          <Typography variant="h1" component="h1" sx={{ fontSize: '1.125rem', flexGrow: 1 }}>
            {t('app.title')}
          </Typography>
          <Box component="nav" aria-label={t('nav.dashboard')} sx={{ display: 'flex', gap: 1 }}>
            <Button component={RouterLink} to="/" color="inherit">
              {t('nav.dashboard')}
            </Button>
            <Button component={RouterLink} to="/settings/availability" color="inherit">
              {t('nav.availability')}
            </Button>
            {user?.role !== 'client' && user !== null && (
              <>
                <Button component={RouterLink} to="/admin/tenants" color="inherit">
                  {t('nav.admin.tenants')}
                </Button>
                <Button component={RouterLink} to="/admin/users" color="inherit">
                  {t('nav.admin.users')}
                </Button>
                <Button component={RouterLink} to="/admin/invitations" color="inherit">
                  {t('nav.admin.invitations')}
                </Button>
              </>
            )}
            <Button
              color="inherit"
              onClick={() => {
                void handleLogout();
              }}
            >
              {t('nav.logout')}
            </Button>
          </Box>
        </Toolbar>
      </AppBar>
      <Container component="main" maxWidth="xl" sx={{ flexGrow: 1, py: 3 }}>
        <Outlet />
      </Container>
    </Box>
  );
}
