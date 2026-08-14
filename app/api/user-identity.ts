import { migrateLegacyUserData } from "../../db/migrate-legacy-user.ts";

export type UserIdentity = {
  userId: string;
  email: string;
  accountKey: string;
  legacyAccountKey: string;
};

async function digestKey(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (item) => item.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Pure header parsing used by tests and non-persistent auth UI. */
export async function identityFromRequest(request: Request): Promise<UserIdentity | null> {
  const userId = request.headers.get("oai-authenticated-user-id")?.trim();
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLocaleLowerCase();
  if (!userId || !email) return null;

  const [accountKey, legacyAccountKey] = await Promise.all([
    digestKey(`site-user:${userId}`),
    // This intentionally reproduces the previous permanent owner key exactly,
    // but is used only as a one-time migration source and local-cache alias.
    digestKey(email),
  ]);
  return { userId, email, accountKey, legacyAccountKey };
}

export async function userIdentityFor(request: Request): Promise<UserIdentity | null> {
  const identity = await identityFromRequest(request);
  if (!identity) return null;
  await migrateLegacyUserData(identity.userId, identity.legacyAccountKey);
  return identity;
}
