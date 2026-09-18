/**
 * DUCKROOM STRUCTURED OBSERVABILITY LOGGER
 *
 * Lightweight, zero-dependency structured JSON logger.
 * Client-boundary safe: contains NO node: imports so it can be evaluated
 * safely in browser and server contexts alike.
 */

export type LogLevel = "info" | "warn" | "error";

export interface LogErrorDetails {
  name?: string | undefined;
  message?: string | undefined;
  stack?: string | undefined;
}

export interface StructuredLogRecord {
  timestamp: string;
  level: LogLevel;
  component: string;
  message: string;
  requestId?: string | undefined;
  metadata?: Record<string, unknown> | undefined;
  error?: LogErrorDetails | undefined;
}

export interface LoggerSink {
  (record: StructuredLogRecord): void;
}

function serializeError(err: unknown): LogErrorDetails | undefined {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return {
    message: typeof err === "string" ? err : JSON.stringify(err),
  };
}

class StructuredLogger {
  private customSink: LoggerSink | null = null;

  /**
   * Allows injecting a custom sink (e.g. for testing or future remote telemetry forwarder).
   */
  public setSink(sink: LoggerSink | null): void {
    this.customSink = sink;
  }

  public createRecord(
    level: LogLevel,
    component: string,
    message: string,
    metadata?: Record<string, unknown>,
    error?: unknown,
    requestId?: string,
  ): StructuredLogRecord {
    const record: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      component,
      message,
    };

    if (requestId) record.requestId = requestId;
    if (metadata && Object.keys(metadata).length > 0) record.metadata = metadata;
    if (error !== undefined && error !== null) record.error = serializeError(error);

    return record;
  }

  private dispatch(record: StructuredLogRecord): void {
    if (this.customSink) {
      this.customSink(record);
      return;
    }

    const json = JSON.stringify(record);
    switch (record.level) {
      case "info":
        console.info(json);
        break;
      case "warn":
        console.warn(json);
        break;
      case "error":
        console.error(json);
        break;
    }
  }

  public info(
    component: string,
    message: string,
    metadata?: Record<string, unknown>,
    requestId?: string,
  ): StructuredLogRecord {
    const record = this.createRecord("info", component, message, metadata, undefined, requestId);
    this.dispatch(record);
    return record;
  }

  public warn(
    component: string,
    message: string,
    metadata?: Record<string, unknown>,
    error?: unknown,
    requestId?: string,
  ): StructuredLogRecord {
    const record = this.createRecord("warn", component, message, metadata, error, requestId);
    this.dispatch(record);
    return record;
  }

  public error(
    component: string,
    message: string,
    error?: unknown,
    metadata?: Record<string, unknown>,
    requestId?: string,
  ): StructuredLogRecord {
    const record = this.createRecord("error", component, message, metadata, error, requestId);
    this.dispatch(record);
    return record;
  }
}

export const logger = new StructuredLogger();
