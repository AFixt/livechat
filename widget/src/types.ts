/**
 * The eight widget states from requirements.md §5.1.
 */
export type WidgetState =
  | 'initial'
  | 'invitation'
  | 'customer_initiated'
  | 'no_support'
  | 'support_initiated'
  | 'active'
  | 'ended'
  | 'restart';

/**
 * A single chat message rendered in the widget.
 */
export interface WidgetMessage {
  id: string;
  body: string;
  senderKind: 'visitor' | 'user' | 'system';
  deliveredAt: string;
}

/**
 * Public tenant configuration surfaced to the widget (colors, icon, hours).
 */
export interface WidgetTenantConfig {
  primaryColor?: string;
  supportHoursText?: string;
  supportPhone?: string;
}
