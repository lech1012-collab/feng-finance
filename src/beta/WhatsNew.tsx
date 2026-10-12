import { useEffect, useRef, useState } from "react";
import type { ReleaseNotes } from "./release";

export function WhatsNew({
  release,
  onClose,
}: {
  release: ReleaseNotes;
  onClose: () => void | Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, []);
  const close = async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onClose();
    } catch {
      setError(
        "Feng could not save that you've read this update. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="beta-notice beta-whats-new"
      aria-labelledby="whats-new-heading"
      onCancel={(e) => {
        e.preventDefault();
        void close();
      }}
    >
      <div className="beta-notice-content">
        <h2 id="whats-new-heading">What's new in Feng</h2>
        <p>
          Version {release.version} ·{" "}
          <time dateTime={release.date}>{release.date}</time>
        </p>
        <ul>
          {release.points.slice(0, 5).map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        <h3>Please test</h3>
        <ul>
          {release.pleaseTest.map((point) => (
            <li key={point}>{point}</li>
          ))}
        </ul>
        {error && <p role="alert">{error}</p>}
        <button
          className="primary"
          disabled={busy}
          onClick={() => void close()}
        >
          Done
        </button>
      </div>
    </dialog>
  );
}
