export class InvalidStateTransitionError extends Error {
  code = "INVALID_STATE_TRANSITION" as const;
  status = 400;
  constructor(from: string, to: string, customMessage?: string) {
    super(customMessage || `Illegal upload session state transition from '${from}' to '${to}'.`);
    this.name = "InvalidStateTransitionError";
  }
}

export class IngestionVerificationError extends Error {
  code = "VERIFICATION_FAILED" as const;
  status = 422;
  constructor(message: string) {
    super(message);
    this.name = "IngestionVerificationError";
  }
}

export class ForbiddenSessionAccessError extends Error {
  code = "FORBIDDEN_SESSION_ACCESS" as const;
  status = 403;
  constructor(message = "Forbidden: Upload session does not belong to the authenticated owner.") {
    super(message);
    this.name = "ForbiddenSessionAccessError";
  }
}

export interface CreateUploadSessionInput {
  expectedFilename: string;
  expectedSizeBytes: number;
  expectedMime: string;
  resourceKind: "track" | "video";
  clientSha256?: string | undefined;
}

export interface FinalizeIngestionCommitInput {
  sessionId: string;
  metadataOverrides?:
    | {
        title?: string | undefined;
        artist?: string | undefined;
        albumId?: string | null | undefined;
        albumTitle?: string | undefined;
        year?: number | undefined;
        trackNo?: number | undefined;
        lyrics?: { time: number; text: string }[] | undefined;
      }
    | undefined;
}
