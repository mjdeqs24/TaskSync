/**
 * Configuration for the Swapify Tasks backend.
 * DB credentials are read from environment variables with sane local defaults
 * that match the provisioned PostgreSQL instance.
 */

const config = {
  db: {
    user: process.env.PGUSER || 'postgres',
    host: process.env.PGHOST || 'localhost',
    database: process.env.PGDATABASE || 'swapify',
    password: process.env.PGPASSWORD || 'postgres',
    port: parseInt(process.env.PGPORT || '5432', 10),
  },
  // Secret used to sign auth tokens (HMAC). Override in production!
  jwtSecret: process.env.JWT_SECRET || 'swapify-dev-secret-change-me',
  // Token lifetime in seconds (default 7 days).
  tokenTtl: parseInt(process.env.TOKEN_TTL || '604800', 10),
  port: parseInt(process.env.PORT || '3001', 10),
};

module.exports = config;