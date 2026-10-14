import { auditedMutation } from "../storage/audit";
import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
export function ThemeSync() {
  const setting = useLiveQuery(() => db.settings.get("theme"), [], null);
  useEffect(() => {
    if (setting === null) return;
    const media = window.matchMedia?.("(prefers-color-scheme: dark)");
    const apply = () => {
      const theme =
        setting?.value === "light"
          ? "light"
          : setting?.value === "system" && media && !media.matches
            ? "light"
            : "dark";
      document.documentElement.dataset.theme = theme;
      try {
        localStorage.setItem("feng-theme", theme);
      } catch {
        /* Storage can be disabled. */
      }
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute("content", theme === "dark" ? "#101217" : "#f3f4f6");
    };
    apply();
    if (setting?.value === "system") media?.addEventListener("change", apply);
    return () => media?.removeEventListener("change", apply);
  }, [setting]);
  return null;
}
export function ThemeSetting() {
  const setting = useLiveQuery(() => db.settings.get("theme"), []);
  return (
    <section className="card">
      <h2>Appearance</h2>
      <div className="theme-options" role="group" aria-label="Appearance">
        {(["dark", "light", "system"] as const).map((theme) => (
          <button
            key={theme}
            aria-pressed={(setting?.value ?? "dark") === theme}
            onClick={() =>
              void auditedMutation("Change appearance", ["settings"], () =>
                db.settings.put({ key: "theme", value: theme }),
              )
            }
          >
            {theme === "dark" ? "Dark" : theme === "light" ? "Light" : "System"}
          </button>
        ))}
      </div>
    </section>
  );
}
