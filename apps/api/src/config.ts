const production = process.env.NODE_ENV === "production";

if (production && !process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET must be set in production");
}

export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://biosphere:biosphere@localhost:5544/biosphere",
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(","),
  jwtSecret: process.env.JWT_SECRET ?? "dev-only-insecure-secret-change-me",
  // Long-lived by default: rangers can be offline in the field for weeks.
  jwtTtl: process.env.JWT_TTL ?? "30d",
  // Sensitive species are snapped to a grid this many degrees wide (~11 km at the equator).
  sensitiveGridDeg: Number(process.env.SENSITIVE_GRID_DEG ?? 0.1),
};
