/**
 * HTTP error with a status code, message, and optional machine-readable detail.
 * @remarks
 * Mirror of help-desk's `ApiError`. Throw these from controllers/services; the
 * `errorHandler` middleware catches them and serializes to the response
 * envelope `{ success: false, message, details? }`.
 */
export class ApiError extends Error {
  /** HTTP status code. */
  public readonly status: number;
  /** Optional machine-readable details (e.g., Zod field-error list). */
  public readonly details: unknown;

  /**
   * Construct an ApiError.
   * @param status - HTTP status code (400–599).
   * @param message - Human-readable message.
   * @param details - Optional structured details for clients to parse.
   */
  public constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }

  /**
   * Convenience constructor for 400 Bad Request.
   * @param message - Error message.
   * @param details - Optional structured details.
   * @returns A new 400 ApiError.
   */
  public static badRequest(message: string, details?: unknown): ApiError {
    return new ApiError(400, message, details);
  }

  /**
   * Convenience constructor for 401 Unauthorized.
   * @param message - Error message.
   * @returns A new 401 ApiError.
   */
  public static unauthorized(message = 'Authentication required'): ApiError {
    return new ApiError(401, message);
  }

  /**
   * Convenience constructor for 403 Forbidden.
   * @param message - Error message.
   * @returns A new 403 ApiError.
   */
  public static forbidden(message = 'Insufficient permissions'): ApiError {
    return new ApiError(403, message);
  }

  /**
   * Convenience constructor for 404 Not Found.
   * @param message - Error message.
   * @returns A new 404 ApiError.
   */
  public static notFound(message = 'Not found'): ApiError {
    return new ApiError(404, message);
  }

  /**
   * Convenience constructor for 409 Conflict.
   * @param message - Error message.
   * @returns A new 409 ApiError.
   */
  public static conflict(message: string): ApiError {
    return new ApiError(409, message);
  }

  /**
   * Convenience constructor for 429 Too Many Requests.
   * @param message - Error message.
   * @returns A new 429 ApiError.
   */
  public static tooManyRequests(message = 'Too many requests'): ApiError {
    return new ApiError(429, message);
  }
}
