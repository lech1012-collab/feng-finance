/** Only app screens that actually open a detail view can be return destinations. */
export function returnTarget(candidate: unknown, fallback = "/transactions") {
  const routeLabels: Record<string, string> = {
    "/": "Home",
    "/transactions": "Transactions",
    "/analysis": "Analyse",
    "/property": "Property",
    "/subscriptions": "Subscriptions",
    "/review": "Monthly review",
  };
  if (typeof candidate === "string") {
    const path = candidate.split(/[?#]/, 1)[0];
    if (Object.hasOwn(routeLabels, path))
      return { to: candidate, label: routeLabels[path] };
    if (/^\/categories\/[\w%-]+$/.test(path))
      return { to: candidate, label: "Category overview" };
  }
  return { to: fallback, label: routeLabels[fallback] };
}
