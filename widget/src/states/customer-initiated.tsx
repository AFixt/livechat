import { useRef, useState } from 'preact/hooks';

interface CustomerInitiatedProps {
  onSubmit: (customerName: string, firstMessage: string) => Promise<void>;
  errorMessage: string | null;
}

/**
 * State 3 (§5.1.3) — name + first-message form. Name is autofocused when
 * the panel opens into this state.
 * @param props - Form callbacks.
 * @returns The form element.
 */
export function CustomerInitiatedState(props: CustomerInitiatedProps): preact.JSX.Element {
  const [name, setName] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const onSubmit = (e: Event): void => {
    e.preventDefault();
    if (name.trim() === '' || message.trim() === '' || submitting) return;
    setSubmitting(true);
    void (async () => {
      try {
        await props.onSubmit(name.trim(), message.trim());
      } finally {
        setSubmitting(false);
      }
    })();
  };

  return (
    <form class="stack" onSubmit={onSubmit}>
      {props.errorMessage !== null && (
        <div class="alert" role="alert">
          {props.errorMessage}
        </div>
      )}
      <label class="field">
        <span>Your name</span>
        <input
          ref={nameRef}
          type="text"
          required
          autoComplete="name"
          value={name}
          onInput={(e) => {
            setName(e.currentTarget.value);
          }}
        />
      </label>
      <label class="field">
        <span>How can we help?</span>
        <textarea
          required
          rows={3}
          value={message}
          onInput={(e) => {
            setMessage(e.currentTarget.value);
          }}
        />
      </label>
      <button type="submit" class="primary" disabled={submitting}>
        {submitting ? 'Starting…' : 'Start chat'}
      </button>
    </form>
  );
}
