import { useEffect, useRef, useState } from "react";

/** Keep a successful dismissal ahead of the asynchronous settings query. */
export function useWhatsNewPrompt(
  eligible: boolean,
  version: string,
  saveAcknowledgement: () => Promise<void>,
) {
  const [visible, setVisible] = useState(false);
  const acknowledgedVersion = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (eligible && acknowledgedVersion.current !== version) setVisible(true);
  }, [eligible, version]);

  const dismiss = async () => {
    await saveAcknowledgement();
    // Closing the dialog makes Home safe again before liveQuery may refresh.
    // Only a successful write suppresses another automatic appearance.
    acknowledgedVersion.current = version;
    setVisible(false);
  };

  return { visible, dismiss };
}
