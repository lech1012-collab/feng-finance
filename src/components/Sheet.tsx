import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { StickyFooter } from "./UIPrimitives";
import "./ux-controls.css";
const FooterContext = createContext<HTMLElement | null>(null);
export function SheetFooter({ children }: { children: ReactNode }) {
  const host = useContext(FooterContext);
  return host ? (
    createPortal(children, host)
  ) : (
    <StickyFooter className="sticky-actions">{children}</StickyFooter>
  );
}

/** Native modal focus/inert handling; the content scrolls above a visible footer. */
export function Sheet({
  title,
  children,
  footer,
  onClose,
  open = true,
}: {
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  onClose: () => void;
  open?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [footerHost, setFooterHost] = useState<HTMLElement | null>(null);
  const titleId = useId();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current!;
    const previous = document.activeElement as HTMLElement | null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    if (dialog.showModal) dialog.showModal();
    else dialog.setAttribute("open", "");
    const resize = () => {
      const viewport = window.visualViewport;
      dialog.style.setProperty(
        "--sheet-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
      dialog.style.setProperty(
        "--keyboard-inset",
        `${Math.max(0, window.innerHeight - (viewport?.height ?? window.innerHeight) - (viewport?.offsetTop ?? 0))}px`,
      );
    };
    resize();
    window.visualViewport?.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("scroll", resize);
    return () => {
      window.visualViewport?.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("scroll", resize);
      dialog.close?.();
      document.body.style.overflow = overflow;
      if (previous?.isConnected) previous.focus();
      else document.getElementById("main")?.focus();
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      className="ux-sheet"
      aria-labelledby={titleId}
      aria-modal="true"
      onCancel={(event) => {
        event.preventDefault();
        close.current();
      }}
    >
      <div className="sheet-grab" aria-hidden="true" />
      <header className="sheet-heading">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="icon-button"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <FooterContext.Provider value={footerHost}>
        <div className="sheet-content">{children}</div>
      </FooterContext.Provider>
      <footer ref={setFooterHost} className="sheet-footer">
        {footer}
      </footer>
    </dialog>
  );
}
