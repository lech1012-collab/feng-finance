import type { SavedReport, SavedView } from "../domain/models";
import { db } from "./database";
import { auditedMutation } from "./audit";
import { validateConditions } from "./rules";
export async function saveView(view: SavedView) {
  if (
    !view.name.trim() ||
    view.name.length > 100 ||
    !["all", "any"].includes(view.match)
  )
    throw new Error("Give this view a name and choose how conditions match.");
  validateConditions(view.conditions);
  return auditedMutation("Save transaction view", ["savedViews"], async () => {
    await db.savedViews.put({ ...view, name: view.name.trim() });
    return view;
  });
}
export async function saveReport(report: SavedReport) {
  if (
    !report.name.trim() ||
    report.name.length > 100 ||
    !["category", "tag", "account", "merchant", "month"].includes(
      report.groupBy,
    ) ||
    !["sum", "count", "average"].includes(report.measure) ||
    !["table", "bar", "line"].includes(report.chart)
  )
    throw new Error("Choose a valid report name, grouping, measure and chart.");
  validateConditions(report.conditions);
  return auditedMutation("Save analysis report", ["savedReports"], async () => {
    await db.savedReports.put({ ...report, name: report.name.trim() });
    return report;
  });
}
