/**
 * Application error classes.
 * These are thrown inside route handlers and caught to produce HTTP responses.
 */

export class AppError extends Error {
  constructor(
    public readonly code: string,
    public readonly status: number,
    public readonly extra?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "AppError";
  }
}

export class Unauthenticated extends AppError {
  constructor(code = "unauthenticated") {
    super(code, 401);
    this.name = "Unauthenticated";
  }
}

export class Forbidden extends AppError {
  constructor(code = "forbidden", extra?: Record<string, unknown>) {
    super(code, 403, extra);
    this.name = "Forbidden";
  }
}

export class NotFound extends AppError {
  constructor(code = "not_found") {
    super(code, 404);
    this.name = "NotFound";
  }
}

export class Conflict extends AppError {
  constructor(code = "conflict", extra?: Record<string, unknown>) {
    super(code, 409, extra);
    this.name = "Conflict";
  }
}

export class Locked extends AppError {
  constructor(code = "account_locked", extra?: Record<string, unknown>) {
    super(code, 423, extra);
    this.name = "Locked";
  }
}

export class UnprocessableEntity extends AppError {
  constructor(code = "validation_error", extra?: Record<string, unknown>) {
    super(code, 422, extra);
    this.name = "UnprocessableEntity";
  }
}
