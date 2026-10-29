export type PhotoSize = "full" | "thumb";

/** Where processed (metadata-stripped) JPEGs live. Access control stays in the API. */
export interface PhotoStorage {
  readonly name: string;
  save(id: string, jpeg: Buffer): Promise<void>;
  read(id: string, size: PhotoSize): Promise<Buffer>;
  remove(id: string): Promise<void>;
}

export const THUMB_EDGE = 400;

export class PhotoNotFoundError extends Error {
  statusCode = 404;
  constructor() {
    super("Photo file not found");
  }
}

export class PhotoStorageUnavailableError extends Error {
  statusCode = 502;
  constructor(detail: string) {
    super(`Photo storage unavailable: ${detail}`);
  }
}
