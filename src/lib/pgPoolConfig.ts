import type { PoolConfig } from "pg";

/**
 * Conexiune Postgres / Supabase folosită de catalog (feed_configs, products).
 * Aliniat la `stream-to-supabase.ts`: pooler 6543 + SSL când se folosesc variabile PG*.
 */
export function buildAppPgPoolConfig(overrides?: Partial<PoolConfig>): PoolConfig {
  const url = process.env.DATABASE_URL?.trim();
  const base: PoolConfig = url
    ? { connectionString: url }
    : {
        host: process.env.PGHOST,
        port: parseInt(process.env.PGPORT || "6543", 10),
        user: process.env.PGUSER,
        password: process.env.PGPASSWORD,
        database: process.env.PGDATABASE,
        ssl: { rejectUnauthorized: false },
      };
  return { max: 4, ...base, ...overrides };
}

export function requirePgEnvConfigured(): void {
  const hasUrl = Boolean(process.env.DATABASE_URL?.trim());
  const hasHost = Boolean(process.env.PGHOST?.trim());
  if (!hasUrl && !hasHost) {
    throw new Error(
      "Postgres: setează DATABASE_URL sau PGHOST / PGUSER / PGPASSWORD / PGDATABASE (vezi Supabase → Database)."
    );
  }
}
