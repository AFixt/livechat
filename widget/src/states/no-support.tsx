import { useState } from 'preact/hooks';

interface NoSupportProps {
  onSubmit: (email: string) => Promise<void>;
  supportHoursText?: string;
  supportPhone?: string;
}

/**
 * State 4 (§5.1.4) — support isn't available; collect the visitor's email
 * so the message can be emailed to the support queue. Also surfaces
 * support hours and a fallback phone number if the tenant has configured
 * them.
 * @param props - Form callbacks + tenant config.
 * @returns The fallback form.
 */
export function NoSupportState(props: NoSupportProps): preact.JSX.Element {
  const [email, setEmail] = useState('');

  const onSubmit = (e: Event): void => {
    e.preventDefault();
    if (email.trim() === '') return;
    void props.onSubmit(email.trim());
  };

  return (
    <div>
      <p>Our support team isn't online right now. Leave us your email and we'll reply.</p>
      <form class="stack" onSubmit={onSubmit}>
        <label class="field">
          <span>Email address</span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onInput={(e) => {
              setEmail(e.currentTarget.value);
            }}
          />
        </label>
        <button type="submit" class="primary">
          Send
        </button>
      </form>
      {(props.supportHoursText !== undefined || props.supportPhone !== undefined) && (
        <address>
          {props.supportHoursText !== undefined && <p>{props.supportHoursText}</p>}
          {props.supportPhone !== undefined && (
            <p>
              Phone: <a href={`tel:${props.supportPhone}`}>{props.supportPhone}</a>
            </p>
          )}
        </address>
      )}
    </div>
  );
}
