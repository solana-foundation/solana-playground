// Kept apart from `models.ts` so a static import of it does not pull the SDK into the boot chunk

/** Same-origin rail whose upstream and key are configured server-side */
export const DEFAULT_BACKEND_URL = "/api/agent";
