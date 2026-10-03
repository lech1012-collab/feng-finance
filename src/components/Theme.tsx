import { useEffect } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../storage/database";
export function ThemeSync() {
  const setting = useLiveQuery(() => db.settings.get("theme"), [], null);
  useEffect(() => {
    if (setting === null) return;
    const theme = setting?.value === "light" ? "light" : "dark";
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem("feng-theme", theme);
    } catch {
      /* Storage can be disabled. */
    }
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "dark" ? "#101715" : "#f3f6f3");
  }, [setting]);
  return null;
}
export function ThemeSetting() {
  const setting = useLiveQuery(() => db.settings.get("theme"), []);
  return (
    <section className="card">
      <h2>Appearance</h2>
      <div className="theme-options" role="group" aria-label="Appearance">
        {(["dark", "light"] as const).map((theme) => (
          <button
            key={theme}
            aria-pressed={(setting?.value ?? "dark") === theme}
            onClick={() => void db.settings.put({ key: "theme", value: theme })}
          >
            {theme === "dark" ? "Dark" : "Light"}
          </button>
        ))}
      </div>
    </section>
  );
}
