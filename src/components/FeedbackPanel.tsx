import { useEffect, useRef, useState } from "react";
import type { ImportDiagnostics } from "../domain/models";
import type {
  FeedbackTechnicalContext,
  ReleaseConfiguration,
} from "../beta/types";
import {
  browserFeedbackContext,
  feedbackDestination,
  technicalContextText,
} from "../beta/feedback";
import { redactedDiagnosticsText } from "../beta/diagnostics-redaction";
import "./accuracy.css";
import "./feedback.css";

export interface FeedbackProps {
  configuration: ReleaseConfiguration;
  diagnostics?: ImportDiagnostics[];
}

function FeedbackDialog({
  configuration,
  diagnostics,
  context,
  onClose,
}: FeedbackProps & {
  diagnostics: ImportDiagnostics[];
  context: FeedbackTechnicalContext;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(false);
  const [copying, setCopying] = useState(false);
  const [prepared, setPrepared] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const destination = feedbackDestination(configuration, context);
  const technical = technicalContextText(context);
  const clipboardText = includeDiagnostics
    ? `${technical}\n\n${redactedDiagnosticsText(diagnostics, configuration.appVersion)}`
    : technical;
  const requiresCopy =
    includeDiagnostics || destination?.contextPrefilled === false;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const copy = async () => {
    setCopying(true);
    setError("");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("clipboard-unavailable");
      await navigator.clipboard.writeText(clipboardText);
      setPrepared(true);
      setNotice(
        includeDiagnostics
          ? "Technical details and redacted diagnostics copied. Paste them into your feedback."
          : "Technical details copied. Paste them into the device and app version question.",
      );
    } catch {
      setError(
        "Your browser could not copy the details. Select and copy the text below, then open feedback.",
      );
    } finally {
      setCopying(false);
    }
  };
  return (
    <dialog
      ref={dialog}
      className="accuracy-dialog feedback-dialog"
      aria-labelledby="feedback-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 id="feedback-title">Send feedback</h2>
        <button onClick={onClose} aria-label="Close feedback">
          Close
        </button>
      </header>
      <p className="feedback-warning">
        Please don't send real statements or screenshots showing real figures.
      </p>
      <p>
        Feedback includes these technical details. It does not include your
        financial records.
      </p>
      <dl className="feedback-context">
        <div>
          <dt>Version</dt>
          <dd>{context.appVersion}</dd>
        </div>
        <div>
          <dt>Build date</dt>
          <dd>{context.buildDate}</dd>
        </div>
        <div>
          <dt>Device</dt>
          <dd>
            {context.deviceType} · {context.operatingSystem}
          </dd>
        </div>
        <div>
          <dt>Browser</dt>
          <dd>{context.browser}</dd>
        </div>
        <div>
          <dt>Display</dt>
          <dd>
            {context.displayMode} · {context.screenWidth}px
          </dd>
        </div>
      </dl>
      {diagnostics.length > 0 && (
        <label className="feedback-diagnostics">
          <input
            type="checkbox"
            checked={includeDiagnostics}
            onChange={(event) => {
              setIncludeDiagnostics(event.target.checked);
              setPrepared(false);
              setNotice("");
            }}
          />
          Include diagnostics
          <div className="muted">
            Copies layout positions and check results only. Every cell's text,
            date and amount is replaced.
          </div>
        </label>
      )}
      {!destination && (
        <p role="status">
          A feedback form or email address has not been configured for this
          build. You can copy the technical details to share with the app owner.
        </p>
      )}
      {destination?.contextPrefilled === false && (
        <p>
          The form has no configured pre-fill field. Feng will copy the details
          so you can paste them into the form.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <div className="accuracy-actions">
        {(!destination || (requiresCopy && !prepared)) && (
          <button
            className="primary"
            onClick={() => {
              void copy();
            }}
            disabled={copying}
          >
            {copying
              ? "Copying…"
              : includeDiagnostics
                ? "Copy details and diagnostics"
                : "Copy technical details"}
          </button>
        )}
        {destination && (!requiresCopy || prepared || error) && (
          <a
            className="button primary"
            href={destination.href}
            target={destination.kind === "form" ? "_blank" : undefined}
            rel="noopener noreferrer"
            referrerPolicy="no-referrer"
          >
            {destination.kind === "form" ? "Open feedback form" : "Open email"}
          </a>
        )}
      </div>
      {(error || !destination) && (
        <label className="feedback-copy">
          Technical details
          <textarea
            aria-label="Technical details to copy"
            value={clipboardText}
            readOnly
            onFocus={(event) => event.currentTarget.select()}
          />
        </label>
      )}
    </dialog>
  );
}

export function FeedbackLink({
  configuration,
  diagnostics = [],
  children = "Send feedback",
}: FeedbackProps & { children?: React.ReactNode }) {
  const [context, setContext] = useState<FeedbackTechnicalContext>();
  return (
    <>
      <button onClick={() => setContext(browserFeedbackContext(configuration))}>
        {children}
      </button>
      {context && (
        <FeedbackDialog
          configuration={configuration}
          diagnostics={diagnostics}
          context={context}
          onClose={() => setContext(undefined)}
        />
      )}
    </>
  );
}

export function FeedbackPanel(props: FeedbackProps) {
  return (
    <div className="feedback-panel">
      <FeedbackLink {...props} />
      <p className="muted">
        Only the feedback you choose to send reaches the app owner.
      </p>
    </div>
  );
}
