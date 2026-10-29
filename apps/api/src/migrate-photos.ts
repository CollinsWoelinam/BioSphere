// Copies photos stored on local disk to Cloudinary, for switching PHOTO_STORAGE=local → cloudinary.
// Usage: CLOUDINARY_URL=cloudinary://… pnpm --filter @biosphere/api photos:to-cloudinary
// Safe to re-run: existing Cloudinary assets are never overwritten.
import { config } from "./config.js";
import { sql } from "./db.js";
import { cloudinaryPhotoStorage } from "./photo-storage/cloudinary.js";
import { localPhotoStorage } from "./photo-storage/local.js";
import { PhotoNotFoundError } from "./photo-storage/types.js";

async function main() {
  if (!process.env.CLOUDINARY_URL) throw new Error("Set CLOUDINARY_URL first");
  const local = localPhotoStorage(config.photoDir);
  const remote = cloudinaryPhotoStorage(config.cloudinaryFolder);
  const rows = await sql<{ id: string }[]>`SELECT id FROM observation_photos ORDER BY created_at`;
  let copied = 0;
  let missing = 0;
  for (const { id } of rows) {
    try {
      await remote.save(id, await local.read(id, "full"));
      copied++;
    } catch (err) {
      if (!(err instanceof PhotoNotFoundError)) throw err;
      missing++;
      console.warn(`no local file for photo ${id}`);
    }
  }
  console.log(`copied ${copied} of ${rows.length} photos to Cloudinary (${missing} missing locally)`);
  console.log("Now set PHOTO_STORAGE=cloudinary and restart the API.");
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => sql.end());
