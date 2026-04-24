import Typography from '@mui/material/Typography';
import { useParams } from 'react-router-dom';

/**
 * Verify-email page (stub) — triggers a GET /auth/verify-email/:token on
 * mount in a later iteration.
 * @returns The page element.
 */
export function VerifyEmailPage(): React.JSX.Element {
  const { token } = useParams<{ token: string }>();
  return (
    <Typography component="p">
      Verifying email — token: <code>{token ?? '(missing)'}</code>.
    </Typography>
  );
}

export default VerifyEmailPage;
