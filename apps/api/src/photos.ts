import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp, { type OutputInfo } from "sharp";
import { config } from "./config.js";

export type PhotoSize = "full" | "thumb";

const MAX_EDGE = 2400;
const THUMB_EDGE = 400;

export class UnsupportedImageError extends Error {
  statusCode = 415;
  constructor() {
    super("Upload must be a JPEG, PNG, WebP or HEIC image");
  }
}

const fileFor = (id: string, size: PhotoSize) => path.join(config.photoDir, `${id}${size === "thumb" ? ".thumb" : ""}.jpg`);

/**
 * Re-encodes an uploaded photo. sharp drops all metadata unless asked to keep it,
 * so EXIF GPS coordinates (which would reveal sensitive-species locations), camera
 * serial numbers and timestamps never reach storage. Orientation is applied to the
 * pixels first so the stripped image still displays upright.
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
  const thumb = await sharp(full.data).resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside" }).jpeg({ quality: 78 }).toBuffer();

  await mkdir(config.photoDir, { recursive: true });
  await Promise.all([atomicWrite(fileFor(id, "full"), full.data), atomicWrite(fileFor(id, "thumb"), thumb)]);
  return { width: full.info.width, height: full.info.height, bytes: full.data.length };
}

export const readPhoto = (id: string, size: PhotoSize) => readFile(fileFor(id, size));

export async function deletePhotoFiles(id: string) {
  await Promise.all((["full", "thumb"] as const).map((s) => unlink(fileFor(id, s)).catch(() => {})));
}

async function atomicWrite(file: string, data: Buffer) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}
