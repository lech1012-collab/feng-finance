import { useEffect, useState } from "react";

interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

// Mount once in the app shell so the event is retained before Settings opens.
export function useDesktopInstall() {
  const [prompt, setPrompt] = useState<InstallPromptEvent>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    const beforeInstall = (event: Event) => {
      event.preventDefault();
      setPrompt(event as InstallPromptEvent);
    };
    const installed = () => setPrompt(undefined);
    window.addEventListener("beforeinstallprompt", beforeInstall);
    window.addEventListener("appinstalled", installed);
    return () => {
      window.removeEventListener("beforeinstallprompt", beforeInstall);
      window.removeEventListener("appinstalled", installed);
    };
  }, []);
  const install = async () => {
    if (!prompt) return;
    setBusy(true);
    setError("");
    try {
      await prompt.prompt();
      await prompt.userChoice;
      setPrompt(undefined);
    } catch {
      setError("Use your browser's Install app option to install Feng.");
    } finally {
      setBusy(false);
    }
  };
  return { available: !!prompt, install, busy, error };
}
