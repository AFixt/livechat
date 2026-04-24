import { Navigate, useLocation } from 'react-router-dom';

import { useAuthStore } from '../store/auth.js';

interface AuthGateProps {
  /** Route element to render when authenticated. */
  children: React.ReactNode;
}

/**
 * Redirect unauthenticated users to the login page, preserving the attempted
 * path in history state so we can bounce them back after login.
 * @param props - AuthGate props.
 * @returns The wrapped element, or a `<Navigate>` to `/login`.
 */
export function AuthGate(props: AuthGateProps): React.JSX.Element {
  const token = useAuthStore((s) => s.accessToken);
  const location = useLocation();
  if (token === null) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{props.children}</>;
}
