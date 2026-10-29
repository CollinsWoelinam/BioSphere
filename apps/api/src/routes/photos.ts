import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { seesExactLocations, type Viewer } from "../auth.js";
import { sql } from "../db.js";
import { deletePhoto, readPhoto, storePhoto } from "../photos.js";

interface PhotoRow {
  id: string;
  observation_id: string;
  width: number;
  height: number;
  bytes: number;
  created_at: Date;
}

interface ObservationAccess {
  observer_id: string | null;
  is_sensitive: boolean;
}

async function observationAccess(observationId: string) {
  const [o] = await sql<ObservationAccess[]>`
    SELECT o.observer_id, COALESCE(s.is_sensitive, FALSE) AS is_sensitive
    FROM species_observations o LEFT JOIN species s USING (species_name)
    WHERE o.id = ${observationId}
  `;
  return o;
}

/**
 * Photo backgrounds (kopjes, rivers, lodges) can pinpoint a location even without
 * EXIF, so citizens cannot view photos of sensitive species at all.
 */
function denyView(v: Viewer, o: ObservationAccess, reply: FastifyReply) {
  if (o.is_sensitive && !seesExactLocations(v)) {
    reply.code(403).send({ error: "Photos of sensitive species are restricted to rangers and researchers" });
    return true;
  }
  return false;
}

const mayEdit = (v: Viewer, o: ObservationAccess) => v.role === "ADMIN" || o.observer_id === v.sub;

const toJson = (p: PhotoRow) => ({
  ...p,
  url: `/photos/${p.id}`,
  thumb_url: `/photos/${p.id}?size=thumb`,
});

export async function photoRoutes(app: FastifyInstance) {
  const params = z.object({ id: z.uuid(), photoId: z.uuid() });

  /**
   * Idempotent upload keyed by a client-generated photo id, so the field app can
   * retry after a dropped connection without creating duplicates.
   */
  app.put("/observations/:id/photos/:photoId", async (req, reply) => {
    const { id, photoId } = params.parse(req.params);
    const obs = await observationAccess(id);
    if (!obs) return reply.code(404).send({ error: "Observation not found" });
    if (!mayEdit(req.user, obs)) return reply.code(403).send({ error: "Only the observer can add photos" });

    const [existing] = await sql<PhotoRow[]>`SELECT * FROM observation_photos WHERE id = ${photoId}`;
    if (existing) {
      if (existing.observation_id !== id) return reply.code(409).send({ error: "Photo id belongs to another observation" });
      return reply.code(200).send(toJson(existing));
    }

    const file = await req.file();
    if (!file) return reply.code(400).send({ error: "Expected a multipart file field named 'photo'" });
    const buffer = await file.toBuffer(); // throws 413 past the configured size limit

    const meta = await storePhoto(photoId, buffer);
    const [row] = await sql<PhotoRow[]>`
      INSERT INTO observation_photos (id, observation_id, uploaded_by, width, height, bytes)
      VALUES (${photoId}, ${id}, ${req.user.sub}, ${meta.width}, ${meta.height}, ${meta.bytes})
      ON CONFLICT (id) DO NOTHING
      RETURNING *
    `;
    if (!row) {
      // A concurrent retry won the race; return its row.
      const [winner] = await sql<PhotoRow[]>`SELECT * FROM observation_photos WHERE id = ${photoId}`;
      return reply.code(200).send(toJson(winner));
    }
    return reply.code(201).send(toJson(row));
  });

  app.get("/observations/:id/photos", async (req, reply) => {
    const { id } = z.object({ id: z.uuid() }).parse(req.params);
    const obs = await observationAccess(id);
    if (!obs) return reply.code(404).send({ error: "Observation not found" });
    if (denyView(req.user, obs, reply)) return;
    const rows = await sql<PhotoRow[]>`
      SELECT * FROM observation_photos WHERE observation_id = ${id} ORDER BY created_at
    `;
    return rows.map(toJson);
  });

  app.get("/photos/:photoId", async (req, reply) => {
    const { photoId } = z.object({ photoId: z.uuid() }).parse(req.params);
    const { size } = z.object({ size: z.enum(["full", "thumb"]).default("full") }).parse(req.query);
    const [photo] = await sql<PhotoRow[]>`SELECT * FROM observation_photos WHERE id = ${photoId}`;
    if (!photo) return reply.code(404).send({ error: "Photo not found" });
    if (denyView(req.user, await observationAccess(photo.observation_id), reply)) return;
    return reply
      .header("content-type", "image/jpeg")
      .header("cache-control", "private, max-age=86400, immutable")
      .send(await readPhoto(photoId, size));
  });

  app.delete("/photos/:photoId", async (req, reply) => {
    const { photoId } = z.object({ photoId: z.uuid() }).parse(req.params);
    const [photo] = await sql<PhotoRow[]>`SELECT * FROM observation_photos WHERE id = ${photoId}`;
    if (!photo) return reply.code(404).send({ error: "Photo not found" });
    if (!mayEdit(req.user, await observationAccess(photo.observation_id))) {
      return reply.code(403).send({ error: "Only the observer can delete photos" });
    }
    await sql`DELETE FROM observation_photos WHERE id = ${photoId}`;
    await deletePhoto(photoId);
    return reply.code(204).send();
  });
}
