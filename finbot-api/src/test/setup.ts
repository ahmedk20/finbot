/**
 * Global test setup — runs before every test file.
 *
 * Must load .env before any module imports env.ts,
 * because env.ts calls process.exit(1) on missing vars.
 */
import 'dotenv/config';
