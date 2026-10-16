import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./ux-review.css";
import "./final-polish.css";
try {
  const preference =
    localStorage.getItem("feng-theme-preference") ??
    localStorage.getItem("feng-theme");
  document.documentElement.dataset.theme =
    preference === "dark" || preference === "light"
      ? preference
      : window.matchMedia?.("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
} catch {
  document.documentElement.dataset.theme = window.matchMedia?.(
    "(prefers-color-scheme: dark)",
  ).matches
    ? "dark"
    : "light";
}
createRoot(document.getElementById("root")!).render(<App />);
