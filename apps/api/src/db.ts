import postgres from "postgres";
import { config } from "./config.js";

export const sql = postgres(config.databaseUrl, {
  max: 10,
  onnotice: () => {},
  types: {
    // Return NUMERIC/BIGINT aggregates (count, area) as JS numbers.
    numeric: { to: 1700, from: [1700, 20], serialize: String, parse: Number },
  },
});

export type Sql = typeof sql;
