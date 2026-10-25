import { useEffect, useRef, useState } from "react";
import { Share, Smartphone, Plus } from "lucide-react";
import type { Setting } from "../domain/models";
import { ContextHelp } from "../components/ContextHelp";
import {
  installDismissedSettings,
  installShownSettings,
  shouldShowInstallBanner,
  type BetaPreferences,
  type RuntimeMode,
} from "./policy";

export function InstallHelp({ mode }: { mode: RuntimeMode }) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState("");
  const copyLink = async () => {
    setError("");
    try {
      if (!navigator.clipboard?.writeText)
        throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(window.location.href.split("#")[0]);
      setCopied(true);
    } catch {
      setError("Copy the address from your browser and open it in Safari.");
    }
  };
  if (mode.installed)
    return <p>Feng is already installed. Open it from your Home Screen.</p>;
  if (mode.ios && !mode.safari)
    return (
      <>
        <p>Open this page in Safari to install Feng.</p>
        <button onClick={() => void copyLink()}>Copy link</button>
        {copied && <p role="status">Link copied. Paste it into Safari.</p>}
        {error && <p role="alert">{error}</p>}
      </>
    );
  if (mode.ios)
    return (
      <>
        <p>Install Feng for the best experience.</p>
        <ol className="install-steps">
          <li>
            <Share aria-hidden="true" size={20} />
            <span>Tap Share in Safari.</span>
          </li>
          <li>
            <Plus aria-hidden="true" size={20} />
            <span>Tap Add to Home Screen.</span>
          </li>
          <li>
            <Smartphone aria-hidden="true" size={20} />
            <span>Tap Add. Enable Open as Web App if Safari offers it.</span>
          </li>
        </ol>
      </>
    );
  return (
    <p>
      Use your browser's Install app option, usually beside the address bar or
      in its menu. In Safari on Mac, choose File → Add to Dock.
    </p>
  );
}

export function InstallBanner({
  prefs,
  mode,
  onSave,
}: {
  prefs: BetaPreferences;
  mode: RuntimeMode;
  onSave: (settings: Setting[]) => Promise<void>;
}) {
  const considered = useRef(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (considered.current) return;
    considered.current = true;
    if (!shouldShowInstallBanner(prefs, mode)) return;
    setVisible(true);
    void onSave(installShownSettings(prefs)).catch(() =>
      setError("Install preferences could not be saved."),
    );
  }, [prefs, mode, onSave]);
  if (!visible || mode.installed) return null;
  const dismiss = async (never: boolean) => {
    setBusy(true);
    try {
      await onSave(installDismissedSettings(prefs, never));
      setVisible(false);
    } catch {
      setError("Your choice could not be saved. Please try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="notice install-banner" aria-label="Install Feng">
      <div>
        <div className="context-help-heading">
          <h2>Install Feng</h2>
          <ContextHelp title="Installing Feng">
            <InstallHelp mode={mode} />
          </ContextHelp>
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="actions">
        <button disabled={busy} onClick={() => void dismiss(false)}>
          Not now
        </button>
        <button disabled={busy} onClick={() => void dismiss(true)}>
          Don't show again
        </button>
      </div>
    </section>
  );
}
