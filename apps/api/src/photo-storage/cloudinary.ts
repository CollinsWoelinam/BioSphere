import { v2 as cloudinary } from "cloudinary";
import { PhotoNotFoundError, PhotoStorageUnavailableError, THUMB_EDGE, type PhotoStorage } from "./types.js";

type Sdk = Pick<typeof cloudinary, "url" | "uploader">;

/**
 * Cloudinary backend.
 *
 * Assets are uploaded as `type: "authenticated"`, so they cannot be fetched without
 * a signature. The API fetches them server-side through signed URLs and streams them
 * to clients after its own permission checks. Signed delivery URLs do not expire on
 * standard plans, so they are never handed to browsers: a leaked link to a
 * sensitive-species photo would otherwise work forever.
 *
 * Only the full image is uploaded; thumbnails are a Cloudinary transformation.
 */
export function cloudinaryPhotoStorage(
  folder: string,
  sdk: Sdk = cloudinary,
  fetchImpl: typeof fetch = fetch,
): PhotoStorage {
  const publicId = (id: string) => `${folder}/${id}`;

  return {
    name: "cloudinary",
    save(id, jpeg) {
      return new Promise((resolve, reject) => {
        const stream = sdk.uploader.upload_stream(
          {
            public_id: publicId(id),
            type: "authenticated",
            resource_type: "image",
            // A retried upload of the same client photo id keeps the first copy.
            overwrite: false,
          },
          (err) => (err ? reject(new PhotoStorageUnavailableError(err.message)) : resolve()),
        );
        stream.end(jpeg);
      });
    },
    async read(id, size) {
      const url = sdk.url(publicId(id), {
        type: "authenticated",
        resource_type: "image",
        sign_url: true,
        secure: true,
        format: "jpg",
        transformation: size === "thumb" ? [{ width: THUMB_EDGE, height: THUMB_EDGE, crop: "limit", quality: "auto:good" }] : [],
      });
      let res: Response;
      try {
        res = await fetchImpl(url);
      } catch (err) {
        throw new PhotoStorageUnavailableError((err as Error).message);
      }
      if (res.status === 404) throw new PhotoNotFoundError();
      if (!res.ok) throw new PhotoStorageUnavailableError(`HTTP ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
    async remove(id) {
      try {
        await sdk.uploader.destroy(publicId(id), { type: "authenticated", resource_type: "image", invalidate: true });
      } catch (err) {
        throw new PhotoStorageUnavailableError((err as Error).message);
      }
    },
  };
}
