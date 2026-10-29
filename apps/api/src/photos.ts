import sharp, { type OutputInfo } from "sharp";
import { config } from "./config.js";
import { cloudinaryPhotoStorage } from "./photo-storage/cloudinary.js";
import { localPhotoStorage } from "./photo-storage/local.js";
import type { PhotoSize, PhotoStorage } from "./photo-storage/types.js";

export type { PhotoSize } from "./photo-storage/types.js";

const MAX_EDGE = 2400;

export class UnsupportedImageError extends Error {
  statusCode = 415;
  constructor() {
    super("Upload must be a JPEG, PNG, WebP or HEIC image");
  }
}

export const storage: PhotoStorage =
  config.photoStorage === "cloudinary"
    ? cloudinaryPhotoStorage(config.cloudinaryFolder)
    : localPhotoStorage(config.photoDir);

/**
 * Re-encodes an uploaded photo before it reaches any storage backend. sharp drops all
 * metadata unless asked to keep it, so EXIF GPS coordinates (which would reveal
 * sensitive-species locations), camera serial numbers and timestamps are never stored,
 * locally or in Cloudinary. Orientation is applied to the pixels first so the image
 * still displays upright.
 */
export async function storePhoto(id: string, input: Buffer) {
  let full: { data: Buffer; info: OutputInfo };
  try {
    full = await sharp(input, { failOn: "error", limitInputPixels: 120_000_000 })
      .rotate()
      .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new UnsupportedImageError();
  }
  await storage.save(id, full.data);
  return { width: full.info.width, height: full.info.height, bytes: full.data.length };
}

export const readPhoto = (id: string, size: PhotoSize) => storage.read(id, size);

export const deletePhoto = (id: string) => storage.remove(id);
