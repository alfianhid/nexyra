// The whole API as one Vercel function. vercel.json rewrites every /api/* request here,
// and Express routes it by the original path, exactly as `npm run server` does locally.
// The database is Turso: set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in the Vercel
// project, because a function has no disk that survives between requests.
import { app } from "../server/index.js";

export default app;
