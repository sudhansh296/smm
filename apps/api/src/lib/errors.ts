export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super(404, message, "NOT_FOUND");
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(401, message, "UNAUTHORIZED");
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(403, message, "FORBIDDEN");
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(400, message, "VALIDATION_ERROR");
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(409, message, "CONFLICT");
  }
}

export class InsufficientBalanceError extends AppError {
  constructor(message = "Insufficient wallet balance") {
    super(402, message, "INSUFFICIENT_BALANCE");
  }
}

export class ServiceUnavailableError extends AppError {
  constructor(message = "Service temporarily unavailable") {
    super(503, message, "SERVICE_UNAVAILABLE");
  }
}
