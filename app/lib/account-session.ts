export type AccountSession =
  | { authenticated: false }
  | { authenticated: true; accountKey: string; legacyAccountKey: string | null };

let accountSessionRequest: Promise<AccountSession> | null = null;

const ACCOUNT_LOCAL_STORAGE_PREFIXES = [
  "em-board-progress-cache-v2:",
  "em-board-progress-outbox-v2:",
  "em-board-guide-progress-cache-v1:",
  "em-board-guide-progress-outbox-v1:",
  "em-board-guide-resource-progress-cache-v1:",
  "em-board-guide-resource-progress-outbox-v1:",
  "em-board-study-plan-v1:",
  "em-board-remoc-course-progress-v1:",
  "em-board-recognized-course-progress-v1:",
  "em-board-board-prep-v1:",
] as const;

function migrateStorageValue(storage: Storage, sourceKey: string, targetKey: string) {
  const source = storage.getItem(sourceKey);
  if (source === null || storage.getItem(targetKey) !== null) return;
  storage.setItem(targetKey, source);
  storage.removeItem(sourceKey);
}

function migrateLegacyBrowserState(session: Extract<AccountSession, { authenticated: true }>) {
  if (typeof window === "undefined" || !session.legacyAccountKey || session.legacyAccountKey === session.accountKey) return;
  try {
    for (const prefix of ACCOUNT_LOCAL_STORAGE_PREFIXES) {
      migrateStorageValue(
        window.localStorage,
        `${prefix}${session.legacyAccountKey}`,
        `${prefix}${session.accountKey}`,
      );
    }
    const sourcePractice = `em-board-active-session-v1:${encodeURIComponent(session.legacyAccountKey)}`;
    const targetPractice = `em-board-active-session-v1:${encodeURIComponent(session.accountKey)}`;
    migrateStorageValue(window.localStorage, sourcePractice, targetPractice);
    migrateStorageValue(window.sessionStorage, sourcePractice, targetPractice);
  } catch {
    // A restricted storage context can still use the remote account. Source
    // data remains untouched unless the target write completed.
  }
}

export function loadAccountSession() {
  if (!accountSessionRequest) {
    accountSessionRequest = fetch("/api/account-session", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("account session unavailable");
        const payload = await response.json() as {
          authenticated?: unknown;
          accountKey?: unknown;
          legacyAccountKey?: unknown;
        };
        if (payload.authenticated === false) return { authenticated: false } as const;
        if (payload.authenticated !== true || typeof payload.accountKey !== "string" || !payload.accountKey) {
          throw new Error("invalid account session");
        }
        const session: Extract<AccountSession, { authenticated: true }> = {
          authenticated: true,
          accountKey: payload.accountKey,
          legacyAccountKey: typeof payload.legacyAccountKey === "string" && payload.legacyAccountKey
            ? payload.legacyAccountKey
            : null,
        };
        migrateLegacyBrowserState(session);
        return session;
      })
      .catch((error: unknown) => {
        accountSessionRequest = null;
        throw error;
      });
  }
  return accountSessionRequest;
}
