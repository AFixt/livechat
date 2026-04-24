import { useState } from 'preact/hooks';

interface EndedProps {
  onEmailTranscript: (email: string) => Promise<void>;
  onDone: () => void;
}

/**
 * State 7 (§5.1.7) — chat ended (support-initiated end). Offer to email a
 * transcript; either path returns the widget to its initial state.
 * @param props - Submit + done callbacks.
 * @returns The chat-ended panel.
 */
export function EndedState(props: EndedProps): preact.JSX.Element {
  const [email, setEmail] = useState('');
  const [sending, setSending] = useState(false);

  const onSubmit = (e: Event): void => {
    e.preventDefault();
    if (email.trim() === '' || sending) return;
    setSending(true);
    void (async () => {
      try {
        await props.onEmailTranscript(email.trim());
        props.onDone();
      } finally {
        setSending(false);
      }
    })();
  };

  return (
    <div>
      <p>Chat ended. Would you like an email copy of this conversation?</p>
      <form class="stack" onSubmit={onSubmit}>
        <label class="field">
          <span>Email address (optional)</span>
          <input
            type="email"
            autoComplete="email"
            value={email}
            onInput={(e) => {
              setEmail(e.currentTarget.value);
            }}
          />
        </label>
        <button type="submit" class="primary" disabled={sending}>
          {sending ? 'Sending…' : 'Send me the transcript'}
        </button>
        <button type="button" onClick={props.onDone}>
          No thanks
        </button>
      </form>
    </div>
  );
}
