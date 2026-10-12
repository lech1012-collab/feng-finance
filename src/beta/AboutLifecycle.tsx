import { useState, type ReactNode } from "react";
import type { RuntimeMode } from "./policy";
import { InstallHelp } from "./InstallGuidance";
import { WhatsNew } from "./WhatsNew";
import { CURRENT_RELEASE, type ReleaseNotes } from "./release";

export interface DesktopInstallControl {
  available: boolean;
  install: () => Promise<void>;
  busy: boolean;
  error: string;
}

export function AboutLifecycle({
  mode,
  storagePersisted,
  buildDate,
  desktopInstall,
  feedback,
  onRequestStorage,
  repositoryUrl = "https://github.com/lech1012-collab/feng-finance",
  release = CURRENT_RELEASE,
}: {
  mode: RuntimeMode;
  storagePersisted: boolean;
  buildDate: string;
  desktopInstall: DesktopInstallControl;
  feedback?: ReactNode;
  onRequestStorage: () => Promise<void>;
  repositoryUrl?: string;
  release?: ReleaseNotes;
}) {
  const [whatsNew, setWhatsNew] = useState(false);
  const [storageBusy, setStorageBusy] = useState(false);
  const [storageError, setStorageError] = useState("");
  return (
    <section className="card beta-about" id="about-feedback">
      <h2>About and feedback</h2>
      <dl className="beta-about-metadata">
        <dt>Version</dt>
        <dd>{release.version}</dd>
        <dt>Build date</dt>
        <dd>
          <time dateTime={buildDate}>{buildDate}</time>
        </dd>
        <dt>Beta round</dt>
        <dd>{release.betaRound}</dd>
      </dl>
      <p>{release.mainTask}</p>
      <button onClick={() => setWhatsNew(true)}>What's new</button>
      {feedback}
      <details>
        <summary>Install help</summary>
        <InstallHelp mode={mode} />
        {desktopInstall.available && (
          <button
            className="primary"
            disabled={desktopInstall.busy}
            onClick={() => void desktopInstall.install()}
          >
            Install Feng
          </button>
        )}
        {desktopInstall.error && <p role="alert">{desktopInstall.error}</p>}
      </details>
      <details>
        <summary>Privacy</summary>
        <h3>Your financial information stays here</h3>
        <p>
          Accounts, transactions, balances, categories, rules and settings are
          stored in this browser's local database. Optional receipts, import
          layouts and optional diagnostics are stored here too. Original
          statement PDFs are discarded after import or cancellation. Diagnostics
          do not retain the PDF.
        </p>
        <p>
          Feng downloads its own app files and, when enabled, public exchange
          rates from the European Central Bank. PDF reading and OCR happen on
          your device and work offline after installation.
        </p>
        <p>
          Statements, descriptions, account numbers, balances and transaction
          history are never sent to the developer. Feng has no analytics,
          tracking pixels, external AI calls or session recording.
        </p>
        <p>
          Feedback opens only when you choose to send it. Technical context
          contains the app version and device details, never your financial
          data. Shared diagnostics replace all extracted text with placeholders.
        </p>
        <p>
          The local database is not encrypted by Feng's app lock. Protect your
          device with a passcode. Export a backup before changing devices or
          clearing browser storage.
        </p>
        <p>
          To remove your data, use Settings → Danger zone → Erase everything.
        </p>
      </details>
      <p role="status">
        {storagePersisted
          ? "Storage: protected"
          : "Storage: may be cleared by the browser. Install Feng and save backups."}
      </p>
      {!storagePersisted && (
        <button
          disabled={storageBusy}
          onClick={() => {
            setStorageBusy(true);
            setStorageError("");
            void onRequestStorage()
              .catch(() =>
                setStorageError(
                  "Your browser may clear Feng's data. Install Feng and save backups.",
                ),
              )
              .finally(() => setStorageBusy(false));
          }}
        >
          Request protected storage
        </button>
      )}
      {storageError && <p role="alert">{storageError}</p>}
      <p className="muted">
        <a
          href={`${repositoryUrl}#readme`}
          target="_blank"
          rel="noopener noreferrer"
        >
          README
        </a>{" "}
        ·{" "}
        <a
          href={`${repositoryUrl}/blob/main/LICENSE`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Licence
        </a>
      </p>
      {whatsNew && (
        <WhatsNew release={release} onClose={() => setWhatsNew(false)} />
      )}
    </section>
  );
}
