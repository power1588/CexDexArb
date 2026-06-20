function normalizeLevel(level) {
  return ["debug", "info", "warn", "error"].includes(level) ? level : "info";
}

export class ManualClock {
  constructor(initialTime = 0) {
    this.currentTime = initialTime;
  }

  now() {
    return this.currentTime;
  }

  set(timeMs) {
    this.currentTime = Number(timeMs);
    return this.currentTime;
  }

  advance(deltaMs) {
    this.currentTime += Number(deltaMs);
    return this.currentTime;
  }
}

export function createInMemoryEventBus() {
  const subscribers = new Map();
  const publishedEvents = [];

  return {
    publish(eventType, payload) {
      const listeners = subscribers.get(eventType) ?? [];
      const event = Object.freeze({
        type: eventType,
        payload,
      });

      publishedEvents.push(event);
      listeners.forEach((listener) => listener(event));
      return event;
    },
    subscribe(eventType, listener) {
      const listeners = subscribers.get(eventType) ?? [];
      subscribers.set(eventType, [...listeners, listener]);

      return () => {
        const nextListeners = (subscribers.get(eventType) ?? []).filter(
          (candidate) => candidate !== listener,
        );
        subscribers.set(eventType, nextListeners);
      };
    },
    getPublishedEvents() {
      return [...publishedEvents];
    },
  };
}

export function createStructuredLogger({ sink } = {}) {
  const entries = [];
  const write = sink ?? (() => undefined);

  function log(level, message, context = {}) {
    const entry = Object.freeze({
      level: normalizeLevel(level),
      message,
      context,
      timestamp: Date.now(),
    });

    entries.push(entry);
    write(entry);
    return entry;
  }

  return {
    debug(message, context) {
      return log("debug", message, context);
    },
    info(message, context) {
      return log("info", message, context);
    },
    warn(message, context) {
      return log("warn", message, context);
    },
    error(message, context) {
      return log("error", message, context);
    },
    child(bindings = {}) {
      return createStructuredLogger({
        sink(entry) {
          write({
            ...entry,
            context: {
              ...bindings,
              ...entry.context,
            },
          });
        },
      });
    },
    getEntries() {
      return [...entries];
    },
  };
}

export function createRuntime({
  clock = new ManualClock(Date.now()),
  eventBus = createInMemoryEventBus(),
  logger = createStructuredLogger(),
} = {}) {
  return Object.freeze({
    clock,
    eventBus,
    logger,
  });
}
