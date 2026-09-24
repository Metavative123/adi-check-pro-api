// Throw this anywhere to send a specific status code to the client.
// Example: throw new ApiError(404, "User not found");
class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
