import Typography from '@mui/material/Typography';
import { useParams } from 'react-router-dom';

/**
 * Accept-invitation page (stub). Full registration form lands in a later
 * iteration.
 * @returns The page element.
 */
export function AcceptInvitationPage(): React.JSX.Element {
  const { token } = useParams<{ token: string }>();
  return (
    <Typography component="p">
      Accept invitation — token: <code>{token ?? '(missing)'}</code>. Registration form not yet
      implemented.
    </Typography>
  );
}

export default AcceptInvitationPage;
