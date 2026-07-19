import { useState } from 'react';
import { useTranslation } from 'react-i18next';

/** Result callbacks handed back to the caller's `mutate` call. */
export interface DialogFormHandlers {
  onSuccess: () => void;
  onError: (error: Error) => void;
}

interface DialogFormOptions {
  /** Closes the dialog. */
  onClose: () => void;
  /** Clears the dialog's field state, if it has any to clear. */
  reset?: () => void;
}

interface DialogForm {
  /** Current submission error, or null when clean. */
  error: string | null;
  /** Resets fields, clears the error, and closes — pass as `onClose`. */
  close: () => void;
  /**
   * Wraps a submit handler: prevents the default form submission, clears any
   * previous error, then hands `onSuccess`/`onError` to the caller's mutation.
   * A successful submission closes the dialog.
   */
  handleSubmit: (run: (handlers: DialogFormHandlers) => void) => (e: React.SyntheticEvent) => void;
}

/**
 * Submission state for an admin dialog form. Owns the error string, the
 * reset-and-close path, and the success/error plumbing, so each dialog only
 * describes how to build and send its own input.
 * @param options - Close handler and optional field reset.
 * @returns The error state, a close handler, and a submit-handler factory.
 */
export function useDialogForm(options: DialogFormOptions): DialogForm {
  const { t } = useTranslation();
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    options.reset?.();
    setError(null);
    options.onClose();
  };

  const handleSubmit =
    (run: (handlers: DialogFormHandlers) => void) =>
    (e: React.SyntheticEvent): void => {
      e.preventDefault();
      setError(null);
      run({
        onSuccess: close,
        onError: (err) => {
          setError(err.message || t('app.error'));
        },
      });
    };

  return { error, close, handleSubmit };
}
