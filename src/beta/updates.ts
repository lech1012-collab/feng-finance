import { useEffect, useState } from "react";
import { mayShowUpdate } from "./policy";

/** Check only the same-origin service worker. Explicit user action still owns activation. */
export function installUpdateChecks(
  registration: Pick<ServiceWorkerRegistration, "update">,
) {
  const check = () => {
    if (navigator.onLine && document.visibilityState !== "hidden")
      void registration.update().catch(() => {});
  };
  const foreground = () => {
    if (document.visibilityState === "visible") check();
  };
  check();
  document.addEventListener("visibilitychange", foreground);
  window.addEventListener("online", check);
  const hourly = window.setInterval(check, 60 * 60 * 1000);
  return () => {
    document.removeEventListener("visibilitychange", foreground);
    window.removeEventListener("online", check);
    window.clearInterval(hourly);
  };
}

export function useSafeUpdateVisibility(pathname: string, busy: boolean) {
  const [openDialog, setOpenDialog] = useState(false);
  useEffect(() => {
    const check = () =>
      setOpenDialog(
        !!document.querySelector("dialog[open], [aria-modal='true']"),
      );
    check();
    const observer = new MutationObserver(check);
    observer.observe(document.body, {
      attributes: true,
      attributeFilter: ["open", "aria-modal"],
      childList: true,
      subtree: true,
    });
    return () => observer.disconnect();
  }, []);
  return mayShowUpdate(pathname, busy, openDialog);
}
