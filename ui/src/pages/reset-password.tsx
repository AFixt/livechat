import Typography from '@mui/material/Typography';
import { useParams } from 'react-router-dom';

/**
 * Reset-password page (stub).
 * @returns The page element.
 */
export function ResetPasswordPage(): React.JSX.Element {
  const { token } = useParams<{ token: string }>();
  return (
    <Typography component="p">
      Reset password — token: <code>{token ?? '(missing)'}</code>. Form not yet implemented.
    </Typography>
  );
}

export default ResetPasswordPage;
