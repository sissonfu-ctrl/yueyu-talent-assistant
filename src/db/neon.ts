import { neon } from '@neondatabase/serverless';

const DATABASE_URL = import.meta.env.VITE_NEON_DATABASE_URL;

if (!DATABASE_URL) {
  throw new Error('VITE_NEON_DATABASE_URL environment variable is not set');
}

// HTTP fetch driver — works in browser, supports both tagged template and parameterized queries
export const sql = neon(DATABASE_URL);
