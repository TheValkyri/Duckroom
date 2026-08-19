import { createServerFn } from "@tanstack/react-start";
import { requireMemberMiddleware, serverSecurityMiddleware } from "./auth-guard";

export const getCurrentRoleServer = createServerFn({ method: "GET" })
  .middleware([serverSecurityMiddleware, requireMemberMiddleware])
  .handler(({ context }) => {
    const auth = (context as { auth?: { userId?: string | null; email?: string | null; role?: "member" | "owner" | null } }).auth;
    return { userId: auth?.userId ?? null, email: auth?.email ?? null, role: auth?.role ?? null };
  });
