import { useEffect, useRef, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import type { Attachment } from "../domain/models";
import { db } from "../storage/database";
import {
  addTransactionAttachment,
  formatStorageBytes,
  MAX_ATTACHMENTS,
  removeTransactionAttachment,
  saveTransactionNote,
} from "../storage/attachments";
import { undoChange } from "../storage/audit";
import "../security/security.css";
function AttachmentItem({
  attachment,
  remove,
  disabled,
}: {
  attachment: Attachment;
  remove: () => void;
  disabled: boolean;
}) {
  const [url, setUrl] = useState("");
  useEffect(() => {
    const objectUrl = URL.createObjectURL(attachment.blob);
    setUrl(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [attachment.blob]);
  return (
    <li>
      <span>
        {attachment.name ||
          (attachment.mime === "application/pdf"
            ? "Attached PDF"
            : "Attached image")}{" "}
        · {formatStorageBytes(attachment.sizeBytes)}
      </span>
      {url && (
        <a href={url} download={attachment.name || "feng-attachment"}>
          Download
        </a>
      )}
      <button
        aria-label={`Remove ${attachment.name || "attachment"}`}
        onClick={remove}
        disabled={disabled}
      >
        Remove
      </button>
      {url && attachment.mime.startsWith("image/") && (
        <img
          className="attachment-preview"
          src={url}
          alt={attachment.name || "Transaction attachment"}
        />
      )}
    </li>
  );
}
export function AttachmentManager({
  transactionId,
}: {
  transactionId: string;
}) {
  const data = useLiveQuery(
    async () => ({
      transaction: await db.transactions.get(transactionId),
      attachments: await db.attachments
        .where("transactionId")
        .equals(transactionId)
        .toArray(),
    }),
    [transactionId],
  );
  const [note, setNote] = useState(""),
    [notice, setNotice] = useState(""),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [changeId, setChangeId] = useState("");
  const input = useRef<HTMLInputElement>(null),
    camera = useRef<HTMLInputElement>(null);
  const noteInitialized = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (data?.transaction && noteInitialized.current !== transactionId) {
      setNote(data.transaction.note ?? "");
      noteInitialized.current = transactionId;
    }
  }, [data?.transaction, transactionId]);
  const run = async (
    action: () => Promise<{ changeId: string }>,
    success: string,
  ) => {
    setBusy(true);
    setError("");
    try {
      const result = await action();
      setChangeId(result.changeId);
      setNotice(success);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The change could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  const attach = (file?: File) => {
    if (file)
      void run(
        () => addTransactionAttachment(transactionId, file),
        "Attachment saved on this device.",
      );
  };
  if (!data?.transaction) return null;
  const count = data.attachments.length;
  return (
    <section className="card" aria-label="Transaction notes and attachments">
      <h2>Notes and attachments</h2>
      <div className="security-fields">
        <label htmlFor={`note-${transactionId}`}>
          Private note
          <textarea
            id={`note-${transactionId}`}
            value={note}
            maxLength={10_000}
            onChange={(event) => setNote(event.target.value)}
            placeholder="What was this payment for?"
          />
        </label>
        <button
          disabled={busy || note.trim() === (data.transaction.note ?? "")}
          onClick={() =>
            void run(
              () => saveTransactionNote(transactionId, note),
              "Note saved.",
            )
          }
        >
          Save note
        </button>
      </div>
      <p className="muted">
        {count} of {MAX_ATTACHMENTS} attachments. Images are compressed to 1600
        pixels. Files stay on this device.
      </p>
      <input
        ref={input}
        className="visually-hidden"
        aria-label="Choose transaction attachment"
        type="file"
        accept="image/jpeg,image/png,image/webp,image/gif,image/heic,image/heif,application/pdf,.pdf"
        disabled={busy || count >= MAX_ATTACHMENTS}
        onChange={(event) => {
          attach(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={camera}
        className="visually-hidden"
        aria-label="Take receipt photo"
        type="file"
        accept="image/*"
        capture="environment"
        disabled={busy || count >= MAX_ATTACHMENTS}
        onChange={(event) => {
          attach(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <div className="security-actions">
        <button
          disabled={busy || count >= MAX_ATTACHMENTS}
          onClick={() => input.current?.click()}
        >
          Attach image or PDF
        </button>
        <button
          disabled={busy || count >= MAX_ATTACHMENTS}
          onClick={() => camera.current?.click()}
        >
          Take a photo
        </button>
      </div>
      <ul className="attachment-list">
        {data.attachments.map((attachment) => (
          <AttachmentItem
            key={attachment.id}
            attachment={attachment}
            disabled={busy}
            remove={() =>
              void run(
                () => removeTransactionAttachment(attachment.id),
                "Attachment removed.",
              )
            }
          />
        ))}
      </ul>
      {notice && (
        <div role="status" className="security-actions">
          <span>{notice}</span>
          {changeId && (
            <button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await undoChange(changeId);
                  setChangeId("");
                  setNotice("Change undone.");
                  const restored = await db.transactions.get(transactionId);
                  setNote(restored?.note ?? "");
                } catch (failure) {
                  setError(
                    failure instanceof Error
                      ? failure.message
                      : "This change could not be undone.",
                  );
                } finally {
                  setBusy(false);
                }
              }}
            >
              Undo
            </button>
          )}
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
