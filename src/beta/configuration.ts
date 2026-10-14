import { APP_VERSION } from "../domain/models";
import type { ReleaseConfiguration } from "./types";

// Vite substitutes the release build's ISO time; local non-bundled tests are explicit.
declare const __FENG_BUILD_DATE__: string;
const nonempty = (value: string | undefined) => value?.trim() || undefined;

/** Fixed public build settings shared by About and import feedback. */
export const RELEASE_CONFIGURATION: ReleaseConfiguration = Object.freeze({
  appVersion: APP_VERSION,
  buildDate:
    typeof __FENG_BUILD_DATE__ === "string"
      ? __FENG_BUILD_DATE__
      : "development",
  feedbackUrl: nonempty(import.meta.env.VITE_FEEDBACK_URL),
  feedbackEmail:
    nonempty(import.meta.env.VITE_FEEDBACK_EMAIL) ?? "lech1012@googlemail.com",
  feedbackContextParameter: nonempty(
    import.meta.env.VITE_FEEDBACK_CONTEXT_PARAMETER,
  ),
});
