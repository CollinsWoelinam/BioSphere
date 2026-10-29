import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { PhotoNotFoundError, THUMB_EDGE, type PhotoSize, type PhotoStorage } from "./types.js";

/** Stores each photo and a pre-rendered thumbnail on local disk. */
export function localPhotoStorage(dir: string): PhotoStorage {
  const fileFor = (id: string, size: PhotoSize) => path.join(dir, `${id}${size === "thumb" ? ".thumb" : ""}.jpg`);

  return {
    name: "local",
    async save(id, jpeg) {
      const thumb = await sharp(jpeg)
        .resize({ width: THUMB_EDGE, height: THUMB_EDGE, fit: "inside" })
        .jpeg({ quality: 78 })
        .toBuffer();
      await mkdir(dir, { recursive: true });
      await Promise.all([atomicWrite(fileFor(id, "full"), jpeg), atomicWrite(fileFor(id, "thumb"), thumb)]);
    },
    async read(id, size) {
      try {
        return await readFile(fileFor(id, size));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") throw new PhotoNotFoundError();
        throw err;
      }
    },
    async remove(id) {
      await Promise.all((["full", "thumb"] as const).map((s) => unlink(fileFor(id, s)).catch(() => {})));
    },
  };
}

async function atomicWrite(file: string, data: Buffer) {
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, data);
  await rename(tmp, file);
}
