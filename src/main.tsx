import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./ux-review.css";
try {
  document.documentElement.dataset.theme =
    localStorage.getItem("feng-theme") === "light" ? "light" : "dark";
} catch {
  /* The default dark theme works without localStorage. */
}
createRoot(document.getElementById("root")!).render(<App />);
