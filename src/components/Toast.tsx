import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import "./ux-controls.css";

type Undo = () => void | Promise<void>;
interface Message {
  key: string;
  message: string;
  undo?: Undo;
}
const ToastContext = createContext<
  ((message: string, undo?: Undo) => void) | undefined
>(undefined);

function ToastView({
  value,
  onDismiss,
}: {
  value: Message;
  onDismiss: () => void;
}) {
  const [busy, setBusy] = useState(false),
    [paused, setPaused] = useState(false),
    [error, setError] = useState("");
  const activeDialog = () =>
    document.activeElement?.closest<HTMLDialogElement>("dialog[open]") ??
    Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]")).at(
      -1,
    );
  const [dialog, setDialog] = useState<HTMLDialogElement | undefined>(
    activeDialog,
  );
  useEffect(() => {
    const observer = new MutationObserver(() => setDialog(activeDialog()));
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["open"],
    });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    if (busy || paused) return;
    const timer = window.setTimeout(onDismiss, 6000);
    return () => window.clearTimeout(timer);
  }, [value.key, busy, paused, onDismiss]);
  const currentDialog = dialog?.isConnected && dialog.open ? dialog : undefined;
  const [bottom, setBottom] = useState<number>();
  const toastRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = toastRef.current;
    if (!node) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue("--feng-toast-clearance");
    const measure = () =>
      root.style.setProperty(
        "--feng-toast-clearance",
        `${node.getBoundingClientRect().height + (bottom ?? 12)}px`,
      );
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : undefined;
    observer?.observe(node);
    return () => {
      observer?.disconnect();
      if (previous) root.style.setProperty("--feng-toast-clearance", previous);
      else root.style.removeProperty("--feng-toast-clearance");
    };
  }, [bottom, currentDialog]);
  useEffect(() => {
    const getObstacles = () =>
      currentDialog
        ? Array.from(
            currentDialog.querySelectorAll<HTMLElement>(
              ".sheet-footer, .category-board-footer",
            ),
          )
        : Array.from(
            document.querySelectorAll<HTMLElement>(
              ".mobile-navigation, .import-outcome-footer, .sticky-actions, .review-footer",
            ),
          );
    const measure = () => {
      const viewportHeight = window.innerHeight;
      const next = currentDialog
        ? getObstacles().reduce((inset, element) => {
            const rect = element.getBoundingClientRect();
            const dialogRect = currentDialog.getBoundingClientRect();
            const border =
              parseFloat(getComputedStyle(currentDialog).borderBottomWidth) ||
              0;
            return rect.width > 0 && rect.height > 0
              ? Math.max(inset, dialogRect.bottom - border - rect.top + 12)
              : inset;
          }, 12)
        : getObstacles().reduce((inset, element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return style.display !== "none" &&
              style.visibility !== "hidden" &&
              (style.position === "fixed" ||
                (style.position === "sticky" && style.bottom !== "auto")) &&
              rect.width > 0 &&
              rect.height > 0
              ? Math.max(inset, viewportHeight - rect.top + 12)
              : inset;
          }, 12);
      setBottom((previous) => (previous === next ? previous : next));
    };
    measure();
    const observer =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(measure)
        : undefined;
    getObstacles().forEach((element) => observer?.observe(element));
    const mutations = new MutationObserver(measure);
    mutations.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    mutations.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });
    window.addEventListener("resize", measure);
    window.visualViewport?.addEventListener("resize", measure);
    return () => {
      observer?.disconnect();
      mutations.disconnect();
      window.removeEventListener("resize", measure);
      window.visualViewport?.removeEventListener("resize", measure);
    };
  }, [currentDialog]);
  const body = (
    <div
      ref={toastRef}
      className={`ux-toast${currentDialog ? " ux-toast--sheet" : ""}`}
      role="status"
      aria-atomic="true"
      style={bottom == null ? undefined : { bottom: `${bottom}px` }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setPaused(false);
      }}
    >
      <span>{error || value.message}</span>
      {value.undo && (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await value.undo?.();
              onDismiss();
            } catch (failure) {
              setError(
                failure instanceof Error
                  ? failure.message
                  : "Undo failed. Your saved data is unchanged.",
              );
              setPaused(true);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? "Undoing…" : "Undo"}
        </button>
      )}
      <button
        type="button"
        className="icon-button"
        aria-label="Dismiss notification"
        onClick={onDismiss}
      >
        ×
      </button>
    </div>
  );
  // The non-modal toast remains in the protected app tree, including privacy cover states.
  return currentDialog ? createPortal(body, currentDialog) : body;
}

/** One success message across the app. The provider lives inside the app lock. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [value, setValue] = useState<Message>();
  const publish = useCallback(
    (message: string, undo?: Undo) =>
      setValue({ key: crypto.randomUUID(), message, undo }),
    [],
  );
  const dismiss = useCallback(
    () =>
      setValue((current) =>
        current?.key === value?.key ? undefined : current,
      ),
    [value?.key],
  );
  return (
    <ToastContext.Provider value={publish}>
      {children}
      {value && <ToastView key={value.key} value={value} onDismiss={dismiss} />}
    </ToastContext.Provider>
  );
}

/** Also works when a focused component is rendered without the full app shell. */
export function Toast({
  message,
  undo,
  id,
}: {
  message: string;
  undo?: Undo;
  id?: string;
}) {
  const publish = useContext(ToastContext),
    localId = useId();
  const action = useRef(undo);
  action.current = undo;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    setDismissed(false);
    if (message && publish)
      publish(message, action.current ? () => action.current?.() : undefined);
  }, [message, id, publish]);
  const dismiss = useCallback(() => setDismissed(true), []);
  return !publish && message && !dismissed ? (
    <ToastView
      value={{ key: id ?? localId + message, message, undo }}
      onDismiss={dismiss}
    />
  ) : null;
}
