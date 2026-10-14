import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { SectionCard } from "./UIPrimitives";

export const settingsTitles: Record<string, string> = {
  appearance: "Appearance",
  currency: "Currency",
  period: "Your month",
  accounts: "Accounts",
  categories: "Categories",
  rules: "Rules",
  tags: "Tags",
  reminders: "Reminders",
  reports: "Reports",
  transfers: "Transfer matching",
  security: "App lock",
  backup: "Backup and restore",
  storage: "Device storage",
  export: "Export",
  changes: "Recent changes",
  demo: "Demo data",
  imports: "Import layouts",
  diagnostics: "Import diagnostics",
  statements: "Statement history",
  about: "About and feedback",
  danger: "Danger zone",
};
const groups = [
  ["Appearance", ["appearance"]],
  ["Money", ["currency", "period", "reports"]],
  ["Transfers", ["transfers"]],
  [
    "Categorisation",
    ["categories", "rules", "imports", "statements", "diagnostics"],
  ],
  ["Reminders", ["reminders"]],
  ["Security", ["security", "storage"]],
  ["Backup and restore", ["backup", "export", "changes"]],
  ["About and feedback", ["about"]],
  ["Demo data", ["demo"]],
  ["Danger zone", ["danger"]],
] as const;
export const settingsSectionsForHash: Record<string, string> = {
  backup: "backup",
  security: "security",
  storage: "storage",
  currency: "currency",
  transfers: "transfers",
  categories: "categories",
  tags: "tags",
  appearance: "appearance",
  statements: "statements",
  danger: "danger",
  "encrypted-backup": "backup",
  "global-currency": "currency",
  rules: "rules",
  "manual-accounts": "accounts",
  "about-feedback": "about",
  demo: "demo",
  "import-layouts": "imports",
  "import-diagnostics": "diagnostics",
  "security-settings": "security",
  "device-storage": "storage",
  "safety-recovery": "backup",
  reminders: "reminders",
};
export function SettingsNavigation() {
  return (
    <nav className="settings-menu" aria-label="Settings sections">
      {groups.map(([name, sections]) => (
        <SectionCard title={name} key={name}>
          <ul>
            {sections.map((section) => (
              <li key={section}>
                <Link
                  className={
                    section === "danger" ? "settings-danger-link" : undefined
                  }
                  to={`/settings?section=${section}`}
                >
                  <span>{settingsTitles[section]}</span>
                  <ChevronRight size={16} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </SectionCard>
      ))}
    </nav>
  );
}
