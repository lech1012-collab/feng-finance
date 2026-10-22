# Barclaycard date recognition — 2.2.18

Some Barclaycard PDFs print an issue date, a later payment deadline and
yearless transaction dates, without printing a statement-period start. These
are different facts. Feng must not present a guessed billing start as printed
evidence, or treat the payment deadline as a statement end.

The native reader already supported issue-date-only transaction coverage. The
generic recovery reader required an explicit printed range and received the
native dates only when the entire native transaction parse succeeded. A failure
elsewhere in that parse could therefore lose readable date evidence and produce
an unnecessary request to type both dates. Date correction also failed to prefill
dates held in a source-only recovery result.

Both readers now share explicit issue-date recognition. A date label/value split
across adjacent text rows and consistent repeated page footers are supported.
The generic Barclaycard reader can derive coverage independently: the earliest
valid dated transaction in the reconstructed ledger to the labelled issue date.
This remains `periodSource: transaction-coverage`, with a statement-level notice.
Due dates, unlabelled cover dates and dates outside transaction cells cannot
supply this evidence. An explicit printed period takes precedence. Conflicting,
invalid or absent date evidence still requires review. Other institutions keep
their existing period-identification rules.

Both date editors retain explicit corrections, existing draft dates and dates
already read by source recovery, in that order. Merely opening an editor does not
change provenance or save data. Parser provenance advances to 2.2.5; database
schema and historical records are unchanged.

Verification uses fictional fixtures for issue-only formats, wrapped labels,
repeated footers, due-date-only statements, invalid/conflicting dates, December
transactions issued in January, native-reader failure and manual date-prefill.
Mobile Chromium/WebKit coverage exercises a multi-PDF import with one coverage
notice and no required manual date entry. Financial reconciliation remains exact.
The original uploaded PDF is checked locally and never added to the repository.
