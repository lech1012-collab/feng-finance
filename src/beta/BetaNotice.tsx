import { useEffect, useRef, useState, type ReactNode } from "react";

export function BetaNotice({
  onAccept,
  installHelp,
}: {
  onAccept: (choice: "demo" | "import") => Promise<void>;
  installHelp?: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const current = dialog.current;
    current?.showModal();
    return () => current?.close();
  }, []);
  const accept = async (choice: "demo" | "import") => {
    setBusy(true);
    setError("");
    try {
      await onAccept(choice);
    } catch {
      setError(
        "Feng could not save your choice. Your data has not been cleared. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="beta-notice beta-introduction"
      aria-labelledby="beta-notice-heading"
      onCancel={(e) => e.preventDefault()}
    >
      <div className="beta-notice-content">
        <span className="small-chip">Private beta</span>
        <h1 id="beta-notice-heading">Welcome to Feng</h1>
        <p>
          Feng is in beta. Check figures against your statements before relying
          on them.
        </p>
        <p>
          Your data stays on this device. Nothing is uploaded, and the developer
          can't see it.
        </p>
        <p>Not financial advice.</p>
        <details className="beta-privacy">
          <summary>How your data is handled ›</summary>
          <p>
            Statements are read on this device. Feng stores your financial
            records in this browser. Clearing browser data removes those
            records. Save an encrypted backup to keep a separate copy.
          </p>
        </details>
        <p>Start with demo data to explore safely.</p>
        {installHelp && (
          <div className="beta-introduction-install">{installHelp}</div>
        )}
        {error && <p role="alert">{error}</p>}
        <div className="beta-notice-actions">
          <button
            className="primary"
            disabled={busy}
            onClick={() => void accept("demo")}
          >
            Explore with demo data
          </button>
          <button disabled={busy} onClick={() => void accept("import")}>
            Import my statements
          </button>
        </div>
      </div>
    </dialog>
  );
}
