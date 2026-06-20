export class ExecutorError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = "ExecutorError";
    this.details = details;
  }
}

export class ConfigError extends ExecutorError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "ConfigError";
  }
}

export class DomainValidationError extends ExecutorError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "DomainValidationError";
  }
}

export class ExchangeAdapterError extends ExecutorError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "ExchangeAdapterError";
  }
}

export class StateTransitionError extends ExecutorError {
  constructor(message, details = {}) {
    super(message, details);
    this.name = "StateTransitionError";
  }
}
