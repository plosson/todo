export type ErrorCode =
  | 'validation_failed'
  | 'unauthenticated'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'internal_error';

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;

  constructor(code: ErrorCode, message: string, status?: number) {
    super(message);
    this.code = code;
    this.status =
      status ??
      ({
        validation_failed: 400,
        unauthenticated: 401,
        forbidden: 403,
        not_found: 404,
        conflict: 409,
        internal_error: 500,
      }[code] ?? 500);
  }
}
