import test from "node:test";
import assert from "node:assert/strict";
import { validateReleaseMetadata } from "./check-release.mjs";

const packageData = { version: "2.2.0" };
const lockData = { version: "2.2.0", packages: { "": { version: "2.2.0" } } };
const model = 'export const APP_VERSION = "2.2.0";';
const current =
  'export const CURRENT_RELEASE: ReleaseNotes = {\n  version: APP_VERSION,\n  date: "2026-10-11",\n};';

test("matching package, lock, app and bundled current changelog pass without a PR tag", () => {
  assert.equal(
    validateReleaseMetadata(packageData, lockData, model, current),
    "2.2.0",
  );
  assert.equal(
    validateReleaseMetadata(packageData, lockData, model, current, "v2.2.0"),
    "2.2.0",
  );
});
test("a stale current entry cannot pass merely because history contains the new version", () => {
  const stale =
    current.replace("version: APP_VERSION", 'version: "2.0.0"') +
    '\nexport const RELEASE_HISTORY = [{ version: "2.2.0" }];';
  assert.throws(
    () => validateReleaseMetadata(packageData, lockData, model, stale),
    /must match/,
  );
});
test("both lockfile version fields must stay aligned with the app", () => {
  assert.throws(
    () =>
      validateReleaseMetadata(
        packageData,
        { ...lockData, version: "2.0.0" },
        model,
        current,
      ),
    /must match/,
  );
  assert.throws(
    () =>
      validateReleaseMetadata(
        packageData,
        { ...lockData, packages: { "": { version: "2.0.0" } } },
        model,
        current,
      ),
    /must match/,
  );
  assert.throws(
    () =>
      validateReleaseMetadata({ version: "2.3.0" }, lockData, model, current),
    /must match/,
  );
});
test("tag events require the matching application version", () => {
  assert.throws(
    () =>
      validateReleaseMetadata(packageData, lockData, model, current, "v2.0.0"),
    /Git tag must match/,
  );
  assert.throws(
    () =>
      validateReleaseMetadata(packageData, lockData, model, current, "2.2.0"),
    /Git tag must match/,
  );
});
test("invalid rollover or missing changelog dates fail", () => {
  for (const badDate of ["2026-02-30", "2026-13-01", "not-a-date"]) {
    assert.throws(
      () =>
        validateReleaseMetadata(
          packageData,
          lockData,
          model,
          current.replace("2026-10-11", badDate),
        ),
      /valid release date/,
    );
  }
});
