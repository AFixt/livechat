let originalTitle: string | null = null;
let unreadCount = 0;

/**
 * Increment the unread-message badge in the browser tab title.
 */
export function incrementBadge(): void {
  originalTitle ??= document.title;
  unreadCount += 1;
  document.title = `(${unreadCount.toString()}) ${originalTitle}`;
}

/**
 * Clear the unread badge and restore the original title.
 */
export function clearBadge(): void {
  if (originalTitle !== null) {
    document.title = originalTitle;
  }
  unreadCount = 0;
}
