# Feedback configuration and privacy

Feedback is inactive until the owner supplies a destination. Do not invent an
email address, publish a third-party form under someone else's account, or collect
financial records. Settings still lets a tester copy technical details.

Configure the static build with:

```dotenv
VITE_FEEDBACK_URL=https://forms.office.com/r/OWNER_FORM
VITE_FEEDBACK_CONTEXT_PARAMETER=OWNER_ACTUAL_QUESTION_KEY
VITE_FEEDBACK_EMAIL=OWNER_EMAIL
```

Use a Microsoft Forms **Get a pre-filled link** for the device/app-version
question. Its question key commonly starts with `r`; the actual key is unique to
the form. Feng appends only its allowlisted technical context to that parameter.
If no question key is provided, Feng copies context and asks the tester to paste
it. When the form address is omitted, a valid configured email address is used
with the context in the email body. A non-empty form address must be valid HTTPS
without embedded credentials; invalid configuration stops the build and must be
corrected before deployment.

Set the same variables in the GitHub Pages build, then deploy a new version.
They are public build configuration, never secrets. `.env.example` shows the
names; private `.env` files are ignored and blocked by repository hygiene.

The warning appears before opening the destination. Nothing is sent until the
tester chooses to open the form/email and submit their feedback. Technical
context includes only app version, build date, inferred device type, operating
system/browser versions, installed/tab display mode and viewport width. Raw user
agents, current URLs, language, timezone, account IDs and financial data are not
attached. The outbound form link has no referrer and no opener access.

Optional diagnostics are copied locally to the clipboard. The exporter rebuilds
a strict structural allowlist; every cell, including dates, amounts, balances and
headers, becomes a placeholder. Layout positions, roles, row kinds, check levels,
issue codes and counts are retained. Names, filenames, identifiers, statement
dates, raw readings, raw differences and image crops are omitted. Keeping raw
diagnostics locally is separate, off by default and capped at five imports.
