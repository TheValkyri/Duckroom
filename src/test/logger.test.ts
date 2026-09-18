import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { logger, type StructuredLogRecord } from "../lib/logger";

describe("Structured JSON Observability Logger", () => {
  beforeEach(() => {
    logger.setSink(null);
    vi.restoreAllMocks();
  });

  afterEach(() => {
    logger.setSink(null);
    vi.restoreAllMocks();
  });

  it("emits info log formatted as structured JSON with timestamp", () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const record = logger.info("auth", "User session verified", { userId: "user-123" }, "req-abc");

    expect(record.level).toBe("info");
    expect(record.component).toBe("auth");
    expect(record.message).toBe("User session verified");
    expect(record.requestId).toBe("req-abc");
    expect(record.metadata).toEqual({ userId: "user-123" });
    expect(new Date(record.timestamp).getTime()).not.toBeNaN();

    expect(infoSpy).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse(infoSpy.mock.calls[0]![0]);
    expect(loggedJson.level).toBe("info");
    expect(loggedJson.component).toBe("auth");
    expect(loggedJson.message).toBe("User session verified");
    expect(loggedJson.requestId).toBe("req-abc");
  });

  it("emits warn log with error and metadata", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const err = new Error("Connection reset");
    const record = logger.warn("s3", "S3 head object retry triggered", { attempt: 2 }, err);

    expect(record.level).toBe("warn");
    expect(record.component).toBe("s3");
    expect(record.error?.name).toBe("Error");
    expect(record.error?.message).toBe("Connection reset");

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse(warnSpy.mock.calls[0]![0]);
    expect(loggedJson.level).toBe("warn");
    expect(loggedJson.error.message).toBe("Connection reset");
  });

  it("emits error log with serialized stack trace", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const err = new TypeError("Invalid parameter");
    const record = logger.error("ingestion", "Pipeline failed", err, { trackId: "track-1" }, "req-999");

    expect(record.level).toBe("error");
    expect(record.component).toBe("ingestion");
    expect(record.requestId).toBe("req-999");
    expect(record.error?.name).toBe("TypeError");
    expect(record.error?.message).toBe("Invalid parameter");
    expect(record.error?.stack).toBeDefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const loggedJson = JSON.parse(errorSpy.mock.calls[0]![0]);
    expect(loggedJson.level).toBe("error");
    expect(loggedJson.component).toBe("ingestion");
    expect(loggedJson.error.name).toBe("TypeError");
  });

  it("supports custom sink for telemetry and interception", () => {
    const collected: StructuredLogRecord[] = [];
    logger.setSink((record) => collected.push(record));

    const infoSpy = vi.spyOn(console, "info");

    logger.info("telemetry", "Custom sink received log", { ping: "pong" });

    expect(collected).toHaveLength(1);
    expect(collected[0]!.component).toBe("telemetry");
    expect(collected[0]!.metadata).toEqual({ ping: "pong" });
    // Console should not be called when custom sink handles it
    expect(infoSpy).not.toHaveBeenCalled();
  });

  it("serializes non-Error error values safely", () => {
    const recordString = logger.createRecord("warn", "test", "String error", undefined, "Plain error string");
    expect(recordString.error?.message).toBe("Plain error string");

    const recordObject = logger.createRecord("warn", "test", "Object error", undefined, { code: 500 });
    expect(recordObject.error?.message).toBe('{"code":500}');
  });
});
