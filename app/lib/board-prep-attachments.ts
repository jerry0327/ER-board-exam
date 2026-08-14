export const BOARD_PREP_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const BOARD_PREP_ATTACHMENT_ACCEPT = ".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png";

const ALLOWED_TYPES = new Set(["application/pdf", "image/jpeg", "image/png"]);
const ALLOWED_EXTENSIONS = new Set(["pdf", "jpg", "jpeg", "png"]);

export type BoardPrepAttachmentMeta = {
  id: string;
  accountKey?: string;
  itemId: string;
  name: string;
  type: string;
  size: number;
  createdAt: string;
  updatedAt?: string;
  revision?: number;
};

export function validateBoardPrepAttachment(file: Pick<File, "name" | "type" | "size">) {
  const extension = file.name.toLocaleLowerCase().split(".").pop() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension) || (file.type && !ALLOWED_TYPES.has(file.type))) {
    throw new Error("請上傳 PDF、JPG 或 PNG 檔案。");
  }
  if (file.size <= 0) throw new Error("這個檔案沒有內容，請重新選擇。");
  if (file.size > BOARD_PREP_ATTACHMENT_MAX_BYTES) throw new Error("檔案上限為 10 MB。");
}

async function responseError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: unknown };
    return typeof payload.error === "string" ? payload.error : fallback;
  } catch {
    return fallback;
  }
}

export async function listBoardPrepAttachments(_accountKey?: string) {
  void _accountKey;
  const response = await fetch("/api/board-prep-evidence", { cache: "no-store" });
  if (!response.ok) throw new Error(await responseError(response, "證明文件暫時無法載入。"));
  const payload = await response.json() as { attachments?: BoardPrepAttachmentMeta[] };
  return Array.isArray(payload.attachments) ? payload.attachments : [];
}

export async function saveBoardPrepAttachment(_accountKey: string, itemId: string, file: File) {
  validateBoardPrepAttachment(file);
  const form = new FormData();
  form.set("recordKey", itemId);
  form.set("file", file);
  const response = await fetch("/api/board-prep-evidence", { method: "POST", body: form });
  if (!response.ok) throw new Error(await responseError(response, "證明文件暫時無法儲存。"));
  const payload = await response.json() as { attachment: BoardPrepAttachmentMeta };
  return payload.attachment;
}

export async function replaceBoardPrepAttachment(_accountKey: string, itemId: string, current: BoardPrepAttachmentMeta, file: File) {
  validateBoardPrepAttachment(file);
  const form = new FormData();
  form.set("recordKey", itemId);
  form.set("replaceId", current.id);
  form.set("baseRevision", String(current.revision ?? 1));
  form.set("file", file);
  const response = await fetch("/api/board-prep-evidence", { method: "POST", body: form });
  if (!response.ok) throw new Error(await responseError(response, "證明文件暫時無法更換。"));
  const payload = await response.json() as { attachment: BoardPrepAttachmentMeta };
  return payload.attachment;
}

export async function downloadBoardPrepAttachment(_accountKey: string, id: string) {
  const response = await fetch(`/api/board-prep-evidence?id=${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) throw new Error(await responseError(response, "證明文件暫時無法下載。"));
  const disposition = response.headers.get("content-disposition") ?? "";
  const encodedName = /filename\*=UTF-8''([^;]+)/iu.exec(disposition)?.[1] ?? "";
  const name = encodedName ? decodeURIComponent(encodedName) : "證明文件";
  const url = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.rel = "noopener";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export async function deleteBoardPrepAttachment(_accountKey: string, id: string) {
  const response = await fetch(`/api/board-prep-evidence?id=${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!response.ok) throw new Error(await responseError(response, "證明文件暫時無法刪除。"));
  return true;
}
