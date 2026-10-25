import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { CircleHelp, TriangleAlert } from "lucide-react";
import { Sheet } from "./Sheet";
import "./context-help.css";

function containModalFocus(event: KeyboardEvent<HTMLDivElement>) {
  event.stopPropagation();
  if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey)
    return;
  const dialog = event.currentTarget.querySelector("dialog[open]");
  if (!dialog) return;
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>(
      "button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])",
    ),
  ).filter(
    (control) =>
      control.getClientRects().length > 0 &&
      !control.closest("[hidden], [inert]"),
  );
  const first = controls[0];
  const last = controls.at(-1);
  if (!first || !last) return;
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

/** Local, on-demand explanations next to the figure or control they describe. */
export function ContextHelp({
  title,
  label = `About ${title}`,
  tone = "help",
  children,
  className = "",
}: {
  title: string;
  label?: string;
  tone?: "help" | "warning";
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const [open, setOpen] = useState(false);
  const [inlineHost, setInlineHost] = useState<HTMLElement | null>(null);

  const findInlineHost = () => {
    const button = trigger.current;
    const dialog = button?.closest("dialog");
    if (!button || !dialog) return null;
    // Do not portal a block panel into a span/legend/label/heading. Editors
    // retain their form and use the nearest valid flow container instead.
    let host: HTMLElement | null = button.parentElement;
    while (host && dialog.contains(host)) {
      if (
        ["DIV", "SECTION", "ASIDE", "FIELDSET", "DIALOG"].includes(
          host.tagName,
        ) &&
        !host.closest(
          "p, label, legend, summary, h1, h2, h3, h4, h5, h6, button, a",
        )
      )
        return host;
      host = host.parentElement;
    }
    return dialog;
  };
  useEffect(() => {
    setInlineHost(findInlineHost());
  }, []);
  useEffect(() => {
    if (!open || !inlineHost) return;
    panel.current?.focus({ preventScroll: true });
    panel.current?.scrollIntoView?.({ block: "nearest" });
  }, [open, inlineHost]);
  useEffect(() => {
    if (!open) return;
    const conceal = (event: Event) => {
      if (document.visibilityState === "hidden" || event.type === "pagehide")
        setOpen(false);
    };
    document.addEventListener("visibilitychange", conceal);
    window.addEventListener("pagehide", conceal);
    return () => {
      document.removeEventListener("visibilitychange", conceal);
      window.removeEventListener("pagehide", conceal);
    };
  }, [open]);

  const close = () => {
    setOpen(false);
    // Touch Safari does not consistently focus a button when it is tapped.
    trigger.current?.focus({ preventScroll: true });
  };
  const Icon = tone === "warning" ? TriangleAlert : CircleHelp;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        className={`context-help-trigger context-help-trigger--${tone} ${className}`.trim()}
        aria-label={label}
        aria-haspopup={inlineHost ? undefined : "dialog"}
        aria-expanded={open}
        aria-controls={id}
        onKeyDown={(event) => event.stopPropagation()}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          event.currentTarget.focus({ preventScroll: true });
          setInlineHost(findInlineHost());
          setOpen((value) => !value);
        }}
      >
        <Icon size={20} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {open &&
        (inlineHost
          ? createPortal(
              <section
                ref={panel}
                id={id}
                className="context-help-content context-help-inline"
                role="region"
                aria-label={title}
                tabIndex={-1}
                onClick={(event) => event.stopPropagation()}
                onKeyDown={(event) => {
                  event.stopPropagation();
                  if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                  }
                }}
              >
                <div className="context-help-heading">
                  <h3>{title}</h3>
                  <button
                    type="button"
                    className="icon-button"
                    aria-label={`Close ${title}`}
                    onClick={close}
                  >
                    ×
                  </button>
                </div>
                {children}
              </section>,
              inlineHost,
            )
          : createPortal(
              <div
                onClick={(event) => event.stopPropagation()}
                onKeyDown={containModalFocus}
              >
                <Sheet id={id} title={title} onClose={close} dismissOnBackdrop>
                  <div className="context-help-content">{children}</div>
                </Sheet>
              </div>,
              trigger.current?.closest(".feng-private-content") ??
                document.body,
            ))}
    </>
  );
}
