import { auditedMutation, undoChange } from "../storage/audit";
import { useEffect, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
import { Toast } from "./Toast";
import { SegmentedControl } from "./UIPrimitives";
export function ThemeSync() {
  const setting = useLiveQuery(() => db.settings.get("theme"), [], null);
  useEffect(() => {
    if (setting === null) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const preference = setting?.value ?? "system";
    const apply = () => {
      const theme =
        preference === "light"
          ? "light"
          : preference === "system" && media && !media.matches
            ? "light"
            : "dark";
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem("feng-theme-preference", preference);
        localStorage.setItem("feng-theme", theme);
      } catch {
        /* Storage can be disabled. */
      }
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", theme === "dark" ? "#101217" : "#f3f4f6");
    };
    apply();
    if (preference === "system") media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [setting]);
  return null;
}
export function ThemeSetting() {
  const setting = useLiveQuery(() => db.settings.get("theme"), []);
  const selected =
    setting?.value === "light" || setting?.value === "dark"
      ? setting.value
      : "system";
  const [notice, setNotice] = useState<{
    message: string;
    changeId: string;
  }>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const save = async (theme: "dark" | "light" | "system") => {
    if (selected === theme) return;
    setBusy(true);
    setError("");
    setNotice(undefined);
    try {
      const { changeId } = await auditedMutation(
        "Change appearance",
        ["settings"],
        () => db.settings.put({ key: "theme", value: theme }),
      );
      setNotice({ message: "Appearance saved.", changeId });
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "Appearance could not be saved.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="card">
      <h2>Appearance</h2>
      <SegmentedControl
        label="Appearance"
        className="theme-options"
        value={selected}
        options={(["system", "dark", "light"] as const).map((theme) => ({
          value: theme,
          label:
            theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System",
          disabled: busy,
        }))}
        onChange={(theme) => void save(theme)}
      />
      {notice && (
        <Toast
          id={notice.changeId}
          message={notice.message}
          undo={
            notice.changeId
              ? async () => {
                  await undoChange(notice.changeId);
                  setNotice(undefined);
                }
              : undefined
          }
        />
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
