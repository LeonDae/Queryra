export class CliError extends Error {
  constructor(message, exitCode = 1, options = {}) {
    super(message, options);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}
