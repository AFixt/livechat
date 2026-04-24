import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { QueryClientProvider } from '@tanstack/react-query';
import { SnackbarProvider } from 'notistack';
import { useMemo } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AuthGate } from './components/auth-gate.js';
import { LiveRegion } from './components/live-region.js';
import { AppShell } from './layouts/app-shell.js';
import { AcceptInvitationPage } from './pages/accept-invitation.js';
import { AdminInvitationsPage } from './pages/admin/invitations.js';
import { AdminTenantsPage } from './pages/admin/tenants.js';
import { AdminUsersPage } from './pages/admin/users.js';
import { AvailabilityPage } from './pages/availability.js';
import { DashboardPage } from './pages/dashboard.js';
import { ForgotPasswordPage } from './pages/forgot-password.js';
import { LoginPage } from './pages/login.js';
import { ResetPasswordPage } from './pages/reset-password.js';
import { VerifyEmailPage } from './pages/verify-email.js';
import { buildQueryClient } from './services/query-client.js';
import { buildTheme } from './theme/index.js';

const queryClient = buildQueryClient();

/**
 * Root React component — theme + query + router + auth-gated routes.
 * @returns The app tree.
 */
export function App(): React.JSX.Element {
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const theme = useMemo(() => buildTheme(prefersDark ? 'dark' : 'light'), [prefersDark]);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        <SnackbarProvider maxSnack={3} anchorOrigin={{ vertical: 'top', horizontal: 'right' }}>
          <BrowserRouter>
            <LiveRegion />
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route path="/accept-invitation/:token" element={<AcceptInvitationPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
              <Route path="/verify-email/:token" element={<VerifyEmailPage />} />
              <Route
                element={
                  <AuthGate>
                    <AppShell />
                  </AuthGate>
                }
              >
                <Route path="/" element={<DashboardPage />} />
                <Route path="/settings/availability" element={<AvailabilityPage />} />
                <Route path="/admin/tenants" element={<AdminTenantsPage />} />
                <Route path="/admin/users" element={<AdminUsersPage />} />
                <Route path="/admin/invitations" element={<AdminInvitationsPage />} />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </BrowserRouter>
        </SnackbarProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
