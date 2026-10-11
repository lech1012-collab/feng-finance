import type { Attachment } from "../domain/models";
import { db, type FinanceDB } from "./database";
import { auditedMutation } from "./audit";
export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 20_000_000;
export function imageDimensions(width: number, height: number, maximum = 1600) {
  if (!(width > 0) || !(height > 0))
    throw new Error("The image dimensions are invalid.");
  const scale = Math.min(1, maximum / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}
function fileMime(file: File) {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split(".").pop()?.toLowerCase();
  return (
    (
      {
        pdf: "application/pdf",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        webp: "image/webp",
        gif: "image/gif",
        heic: "image/heic",
        heif: "image/heif",
      } as Record<string, string>
    )[extension ?? ""] ?? ""
  );
}
async function imageSource(file: File): Promise<{
  source: CanvasImageSource;
  width: number;
  height: number;
  release: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        source: bitmap,
        width: bitmap.width,
        height: bitmap.height,
        release: () => bitmap.close(),
      };
    } catch {
      /* Safari may support a format through HTMLImageElement instead. */
    }
  }
  const url = URL.createObjectURL(file),
    image = new Image();
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () =>
        reject(
          new Error(
            "This image could not be decoded. Choose a JPEG, PNG or another supported image.",
          ),
        );
      image.src = url;
    });
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      release: () => URL.revokeObjectURL(url),
    };
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
export async function prepareAttachment(
  file: File,
): Promise<{ blob: Blob; mime: string; name: string }> {
  if (!file.size || file.size > MAX_ATTACHMENT_BYTES)
    throw new Error("Choose a file smaller than 20 MB.");
  const mime = fileMime(file);
  if (mime === "application/pdf") {
    const signature = new TextDecoder().decode(
      await file.slice(0, 1024).arrayBuffer(),
    );
    if (!signature.includes("%PDF-"))
      throw new Error("This file is not a valid PDF.");
    return {
      blob: file.slice(0, file.size, "application/pdf"),
      mime: "application/pdf",
      name: file.name,
    };
  }
  if (!/^image\/(jpeg|png|webp|gif|heic|heif|bmp|tiff)$/.test(mime))
    throw new Error(
      "Attachments must be images or PDFs. SVG and HTML files are not supported.",
    );
  const image = await imageSource(file);
  try {
    const dimensions = imageDimensions(image.width, image.height),
      canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context)
      throw new Error("Image compression is unavailable in this browser.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image.source, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) =>
          value
            ? resolve(value)
            : reject(new Error("This image could not be compressed.")),
        "image/jpeg",
        0.82,
      ),
    );
    return {
      blob,
      mime: "image/jpeg",
      name: file.name.replace(/\.[^.]*$/, "") + ".jpg",
    };
  } finally {
    image.release();
  }
}
/** Decode/compress outside the IndexedDB transaction, then commit attachment and references atomically. */
export async function addTransactionAttachment(
  transactionId: string,
  file: File,
  database: FinanceDB = db,
) {
  const prepared = await prepareAttachment(file);
  const attachment: Attachment = {
    id: crypto.randomUUID(),
    transactionId,
    blob: prepared.blob,
    mime: prepared.mime,
    sizeBytes: prepared.blob.size,
    name: prepared.name.slice(0, 200),
    createdAt: new Date().toISOString(),
  };
  return auditedMutation(
    "Add transaction attachment",
    ["transactions", "attachments"],
    async () => {
      const transaction = await database.transactions.get(transactionId);
      if (!transaction) throw new Error("Transaction no longer exists.");
      if (
        (await database.attachments
          .where("transactionId")
          .equals(transactionId)
          .count()) >= MAX_ATTACHMENTS
      )
        throw new Error(
          "A transaction can have up to 5 attachments. Remove one before adding another.",
        );
      await database.attachments.add(attachment);
      await database.transactions.update(transactionId, {
        attachmentIds: [...(transaction.attachmentIds ?? []), attachment.id],
        updatedAt: new Date().toISOString(),
      });
      return attachment;
    },
    database,
  );
}
export async function removeTransactionAttachment(
  attachmentId: string,
  database: FinanceDB = db,
) {
  return auditedMutation(
    "Remove transaction attachment",
    ["transactions", "attachments"],
    async () => {
      const attachment = await database.attachments.get(attachmentId);
      if (!attachment) throw new Error("Attachment no longer exists.");
      const transaction = await database.transactions.get(
        attachment.transactionId,
      );
      await database.attachments.delete(attachmentId);
      if (transaction)
        await database.transactions.update(transaction.id, {
          attachmentIds: (transaction.attachmentIds ?? []).filter(
            (id) => id !== attachmentId,
          ),
          updatedAt: new Date().toISOString(),
        });
    },
    database,
  );
}
export async function saveTransactionNote(
  transactionId: string,
  note: string,
  database: FinanceDB = db,
) {
  if (note.length > 10_000)
    throw new Error("Keep notes within 10,000 characters.");
  return auditedMutation(
    "Edit transaction note",
    ["transactions"],
    async () => {
      if (!(await database.transactions.get(transactionId)))
        throw new Error("Transaction no longer exists.");
      await database.transactions.update(transactionId, {
        note: note.trim() || undefined,
        updatedAt: new Date().toISOString(),
      });
    },
    database,
  );
}
export async function attachmentStorageBytes(database: FinanceDB = db) {
  let total = 0;
  await database.attachments.each((attachment) => {
    total += attachment.sizeBytes;
  });
  return total;
}
export async function requestPersistentStorage(): Promise<boolean> {
  if (!navigator.storage?.persist) return false;
  return navigator.storage.persist();
}
export async function storageUsage(database: FinanceDB = db) {
  const [estimate, attachments] = await Promise.all([
    navigator.storage?.estimate?.() ?? Promise.resolve({} as StorageEstimate),
    attachmentStorageBytes(database),
  ]);
  return {
    usedBytes: estimate.usage,
    quotaBytes: estimate.quota,
    attachmentBytes: attachments,
    nearlyFull:
      !!estimate.quota && (estimate.usage ?? 0) / estimate.quota >= 0.8,
  };
}
export function formatStorageBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1_048_576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1_048_576).toFixed(1)} MB`;
}
