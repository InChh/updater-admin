import { createAuthClient } from "better-auth/solid";

// Better Auth owns credential and cookie mutations. TanStack Query owns the
// browser session cache through session-query.ts.
export const authClient = createAuthClient({ basePath: "/api/auth" });
