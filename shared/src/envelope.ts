/**
 * Standard response envelope used by the livechat API for every endpoint.
 * @remarks
 * Matches the shape used by help-desk: `{ success, data, message, pagination }`.
 */
export interface ApiEnvelope<T> {
  /** Whether the request succeeded. `false` for error responses. */
  success: boolean;
  /** Payload data on success. Absent on error. */
  data?: T;
  /** Human-readable message. Always present on error; optional on success. */
  message?: string;
  /** Pagination metadata for list endpoints. */
  pagination?: PaginationMeta;
}

/**
 * Pagination metadata returned alongside list responses.
 */
export interface PaginationMeta {
  /** 1-indexed page number. */
  page: number;
  /** Number of items per page. */
  pageSize: number;
  /** Total number of items across all pages. */
  total: number;
}
