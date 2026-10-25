export class HttpError extends Error {
  constructor(status, message, code = "REQUEST_FAILED") {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
  }
}
