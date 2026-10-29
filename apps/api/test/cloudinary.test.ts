// Unit tests for the Cloudinary backend. URL signing uses the real SDK (pure computation,
// no network); uploads, deletes and fetches are faked so no account is needed.
import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { Writable } from "node:stream";
import { v2 as cloudinary } from "cloudinary";
import { cloudinaryPhotoStorage } from "../src/photo-storage/cloudinary.js";
import { PhotoNotFoundError, PhotoStorageUnavailableError } from "../src/photo-storage/types.js";

cloudinary.config({ cloud_name: "demo-cloud", api_key: "123", api_secret: "test-secret" });

function fakeSdk(uploadError?: Error) {
  const calls: { upload?: Record<string, unknown>; uploaded?: Buffer; destroy?: [string, Record<string, unknown>] } = {};
  const sdk = {
    url: cloudinary.url,
    uploader: {
      upload_stream(options: Record<string, unknown>, cb: (err?: Error) => void) {
        calls.upload = options;
        const chunks: Buffer[] = [];
        return new Writable({
          write(chunk, _enc, next) {
            chunks.push(chunk);
            next();
          },
          final(done) {
            calls.uploaded = Buffer.concat(chunks);
            cb(uploadError);
            done();
          },
        });
      },
      async destroy(id: string, options: Record<string, unknown>) {
        calls.destroy = [id, options];
        return { result: "ok" };
      },
    },
  } as unknown as Parameters<typeof cloudinaryPhotoStorage>[1];
  return { sdk, calls };
}

const fetchReturning = (status: number, body = "jpeg-bytes", seen: string[] = []) =>
  (async (url: string | URL | Request) => {
    seen.push(String(url));
    return new Response(body, { status });
  }) as typeof fetch;

describe("cloudinary photo storage", () => {
  test("uploads as an authenticated (non-public) asset under the folder", async () => {
    const { sdk, calls } = fakeSdk();
    const store = cloudinaryPhotoStorage("biosphere/photos", sdk);
    await store.save("abc-123", Buffer.from("jpeg"));
    assert.equal(calls.upload?.public_id, "biosphere/photos/abc-123");
    assert.equal(calls.upload?.type, "authenticated");
    assert.equal(calls.upload?.overwrite, false);
    assert.equal(calls.uploaded?.toString(), "jpeg");
  });

  test("reads through signed URLs; thumbnails use a Cloudinary transformation", async () => {
    const seen: string[] = [];
    const store = cloudinaryPhotoStorage("biosphere/photos", fakeSdk().sdk, fetchReturning(200, "jpeg-bytes", seen));
    assert.equal((await store.read("abc-123", "full")).toString(), "jpeg-bytes");
    await store.read("abc-123", "thumb");

    const [full, thumb] = seen;
    assert.match(full, /^https:\/\/res\.cloudinary\.com\/demo-cloud\/image\/authenticated\/s--[\w-]{8}--\//);
    assert.match(full, /\/biosphere\/photos\/abc-123\.jpg(\?|$)/);
    assert.match(thumb, /\/c_limit,h_400,q_auto:good,w_400\//);
    assert.match(thumb, /\/s--[\w-]{8}--\//, "transformations must be signed too");
    assert.ok(!full.includes("test-secret"));
  });

  test("maps 404 to not-found and other failures to 502", async () => {
    const { sdk } = fakeSdk();
    await assert.rejects(cloudinaryPhotoStorage("f", sdk, fetchReturning(404)).read("x", "full"), PhotoNotFoundError);
    await assert.rejects(cloudinaryPhotoStorage("f", sdk, fetchReturning(500)).read("x", "full"), PhotoStorageUnavailableError);
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    await assert.rejects(cloudinaryPhotoStorage("f", sdk, offline).read("x", "full"), PhotoStorageUnavailableError);
  });

  test("upload errors surface as storage-unavailable", async () => {
    const { sdk } = fakeSdk(new Error("Invalid credentials"));
    await assert.rejects(cloudinaryPhotoStorage("f", sdk).save("x", Buffer.from("j")), /Invalid credentials/);
  });

  test("delete targets the authenticated asset and invalidates CDN caches", async () => {
    const { sdk, calls } = fakeSdk();
    await cloudinaryPhotoStorage("biosphere/photos", sdk).remove("abc-123");
    assert.deepEqual(calls.destroy, ["biosphere/photos/abc-123", { type: "authenticated", resource_type: "image", invalidate: true }]);
  });
});
