import { act, renderHook } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { describe, expect, it, vi } from 'vitest';

import { initI18n } from '../../i18n/index.js';

import { useDialogForm } from './use-dialog-form.js';

import type { DialogFormHandlers } from './use-dialog-form.js';

const i18n = initI18n();

function renderDialogForm(options: { onClose: () => void; reset?: () => void }) {
  return renderHook(() => useDialogForm(options), {
    wrapper: ({ children }) => <I18nextProvider i18n={i18n}>{children}</I18nextProvider>,
  });
}

/** A submit event stub that records whether the default was prevented. */
function submitEvent(): { event: React.SyntheticEvent; prevented: () => boolean } {
  const preventDefault = vi.fn();
  return {
    event: { preventDefault } as unknown as React.SyntheticEvent,
    prevented: () => preventDefault.mock.calls.length > 0,
  };
}

/** Mutation stub that reports success. */
const succeed = (handlers: DialogFormHandlers): void => {
  handlers.onSuccess();
};

/** Mutation stub that never settles. */
const pending = (): void => undefined;

/**
 * Builds a mutation stub that fails with the given message.
 * @param message - Error message to report.
 * @returns A run function for `handleSubmit`.
 */
function failWith(message: string): (handlers: DialogFormHandlers) => void {
  return (handlers) => {
    handlers.onError(new Error(message));
  };
}

describe('useDialogForm', () => {
  it('starts with no error', () => {
    const { result } = renderDialogForm({ onClose: vi.fn() });
    expect(result.current.error).toBeNull();
  });

  it('prevents the browser form submission', () => {
    const { result } = renderDialogForm({ onClose: vi.fn() });
    const { event, prevented } = submitEvent();
    act(() => {
      result.current.handleSubmit(pending)(event);
    });
    expect(prevented()).toBe(true);
  });

  it('closes and resets fields on a successful submission', () => {
    const onClose = vi.fn();
    const reset = vi.fn();
    const { result } = renderDialogForm({ onClose, reset });
    act(() => {
      result.current.handleSubmit(succeed)(submitEvent().event);
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });

  it('surfaces the mutation error message and stays open', () => {
    const onClose = vi.fn();
    const { result } = renderDialogForm({ onClose });
    act(() => {
      result.current.handleSubmit(failWith('Slug already taken'))(submitEvent().event);
    });
    expect(result.current.error).toBe('Slug already taken');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('falls back to the generic error text when the error has no message', () => {
    const { result } = renderDialogForm({ onClose: vi.fn() });
    act(() => {
      result.current.handleSubmit(failWith(''))(submitEvent().event);
    });
    expect(result.current.error).toBe('Something went wrong');
  });

  it('clears a previous error when the form is resubmitted', () => {
    const { result } = renderDialogForm({ onClose: vi.fn() });
    act(() => {
      result.current.handleSubmit(failWith('boom'))(submitEvent().event);
    });
    expect(result.current.error).toBe('boom');

    act(() => {
      result.current.handleSubmit(pending)(submitEvent().event);
    });
    expect(result.current.error).toBeNull();
  });

  it('close() resets, clears the error, and closes', () => {
    const onClose = vi.fn();
    const reset = vi.fn();
    const { result } = renderDialogForm({ onClose, reset });
    act(() => {
      result.current.handleSubmit(failWith('boom'))(submitEvent().event);
    });
    act(() => {
      result.current.close();
    });
    expect(reset).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(result.current.error).toBeNull();
  });
});
