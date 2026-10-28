export const config = {
  databaseUrl:
    process.env.DATABASE_URL ?? "postgres://biosphere:biosphere@localhost:5544/biosphere",
  port: Number(process.env.PORT ?? 4000),
  host: process.env.HOST ?? "0.0.0.0",
  corsOrigin: (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(","),
};
