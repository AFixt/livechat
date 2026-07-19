import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import { useTranslation } from 'react-i18next';

interface FormDialogProps {
  open: boolean;
  /** Dialog title, which also names the dialog for assistive tech. */
  title: string;
  /** Error text shown in an `alert` above the fields; null when clean. */
  error: string | null;
  /** Label for the confirming button, e.g. "Save" or "Create". */
  submitLabel: string;
  /** Disables the submit button while a mutation is in flight. */
  submitting: boolean;
  onClose: () => void;
  onSubmit: (event: React.SyntheticEvent) => void;
  /** The form fields. */
  children: React.ReactNode;
}

/**
 * Shared modal form shell for admin dialogs — wires the `form` submit,
 * the error `alert`, and the cancel/submit actions so every admin dialog
 * behaves and announces errors identically.
 * @param props - Dialog state, labels, handlers, and field children.
 * @returns The dialog element.
 */
export function FormDialog(props: FormDialogProps): React.JSX.Element {
  const { t } = useTranslation();
  const { open, title, error, submitLabel, submitting, onClose, onSubmit, children } = props;

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <form onSubmit={onSubmit}>
        <DialogTitle>{title}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ mt: 1 }}>
            {error !== null && (
              <Alert severity="error" role="alert">
                {error}
              </Alert>
            )}
            {children}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>{t('admin.common.cancel')}</Button>
          <Button type="submit" variant="contained" disabled={submitting}>
            {submitLabel}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
