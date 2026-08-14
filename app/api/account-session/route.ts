import { privateJson } from "../private-response";
import { userIdentityFor } from "../user-identity";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const identity = await userIdentityFor(request);
    if (!identity) return privateJson({ authenticated: false });
    return privateJson({
      authenticated: true,
      accountKey: identity.accountKey,
      legacyAccountKey: identity.legacyAccountKey,
    });
  } catch {
    return privateJson({ error: "無法確認登入狀態，請再試一次。" }, { status: 503 });
  }
}
