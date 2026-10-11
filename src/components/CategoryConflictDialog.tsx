import { useEffect, useRef } from "react";
import "./accuracy.css";
export type CategoryConflictDecision = "update" | "once";
export function CategoryConflictDialog({
  oldCategory,
  newCategory,
  onDecision,
  onCancel,
}: {
  oldCategory: string;
  newCategory: string;
  onDecision: (decision: CategoryConflictDecision) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="accuracy-dialog"
      aria-label="Update a saved rule?"
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <header>
        <h2 id="rule-conflict-title">Update a saved rule?</h2>
        <button aria-label="Close rule conflict" onClick={onCancel}>
          ✕
        </button>
      </header>
      <p>
        A saved rule uses {oldCategory} for this merchant. You chose{" "}
        {newCategory}.
      </p>
      <p>Update future matching payments, or change only this payment?</p>
      <div className="accuracy-actions">
        <button className="primary" onClick={() => onDecision("update")}>
          Update rule
        </button>
        <button onClick={() => onDecision("once")}>Just this payment</button>
      </div>
    </dialog>
  );
}
