# Feng beta testing

Feng is a beta, with no login accounts, telemetry or analytics. Testers' records
stay in their own browser or installed app. The developer cannot see or recover
them. Check financial figures against the original statements before relying on
them. Nothing in the app is financial advice.

## The first round

Invite 5–10 volunteers for a two-week round, covering Barclays, Barclaycard,
American Express and Revolut. Include at least three iPhone users and one desktop
user. Invitations and calls are organised by the owner; Feng does not send them.

Ask each tester to:

1. Open the HTTPS link, read the notice and explore fictitious demo data.
2. On iPhone, follow the installation help and open Feng from its Home Screen icon.
3. Delete demo data, import one month of statements and check each statement's
   balances and Money in/Money out against the PDF.
4. Categorise everything, confirm an account transfer/card repayment, and check
   that transfers remain excluded from spending.
5. Save a backup. Restore it in a separate test browser/profile and verify the
   accounts and transaction count before deleting that test profile.
6. Import and browse with the network offline after Offline ready appears.
7. When an update is available, complete any current import before returning Home
   and reloading. Check What's new and confirm existing records remain intact.
8. Send feedback through Settings. Never send real statements or screenshots
   showing real figures. Optional diagnostics contain placeholders for every cell.

Record timings and observations manually: time to finish the monthly routine,
where someone got stuck, layout problems by bank, import ease from 1 to 5, and
whether they would keep using Feng. Conduct a 15-minute conversation with 3–5
testers at the end. There is no in-app tracking of this activity.

Fix the five most important problems before the next round. Before inviting
people, choose the threshold for continuing; for example, at least half finish
the monthly workflow and would use Feng again.

## Owner preparation

- Check side-project ownership and employer requirements before wider sharing.
- Decide whether to keep the public source repository and its current licence.
  The supplied conservative licence reserves rights until the owner chooses one.
- Provide a feedback form or email. A Microsoft Form can ask what the tester was
  trying to do, what happened, which banks were imported, import ease (1–5), other
  comments, and device/app version. Do not request statements or real figures.
- To prefill device/app version, provide the actual question parameter from the
  Form's prefilled link. Without it, Feng copies technical details for pasting.
- Decide whether to use a custom domain. It is optional for this round.
- Recruit volunteers and supply the link, installation steps, demo-first advice,
  privacy information, task and feedback channel.

## Release record

The version in Settings, the Git release tag and the bundled What's new entry
must match. CI checks release metadata and repository hygiene before a Pages
deployment. Physical iPhone testing remains separate from Playwright WebKit.
