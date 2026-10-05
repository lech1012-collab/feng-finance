export type Section =
  "home" | "import" | "transactions" | "analysis" | "settings";

/** One source of truth for the page palette and the selected navigation tab. */
export function sectionForPath(pathname: string): Section {
  const root = pathname.split("/")[1];
  if (root === "transactions") return "transactions";
  if (root === "import") return "import";
  if (root === "settings") return "settings";
  if (["analysis", "categories", "property", "subscriptions"].includes(root))
    return "analysis";
  return "home";
}
