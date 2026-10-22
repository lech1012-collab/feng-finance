# Annual Barclaycard summary recognition — 2.2.19

The supported annual Barclaycard report contains annual purchase, cash, interest,
fee and repayment totals. It does not contain individual dated transactions or
opening and closing balances. Its aggregate figures cannot reconstruct the
underlying ledger or be imported alongside monthly statements without double
counting activity.

Previously this document entered generic transaction recovery. Its annual period
shared a PDF row with unrelated totals in a different column, so full-page date
matching failed. Supplying manual dates then produced spurious review questions
from annual overview and interest-rate text, with no legitimate transactions.

The importer now recognises the document from its annual title, Barclaycard
identity, annual-summary heading and annual-overview section. A genuine
transaction ledger keeps a document on the transaction-reading route. Incomplete
or unread pages cannot establish that a document is summary-only.

The printed period is reconstructed within the annual-summary column. The
labelled issue date is read separately; neither interest-rate dates nor an
assumed twelve-month interval supply a missing period. Missing or conflicting
dates stay unavailable. Unique labelled cover totals appear as read-only source
figures, without claims of reconciliation or a calculated account balance.

An annual-summary result is excluded from transaction imports automatically and
remains visible with its dates and an explanation, including under the attention
filter. It offers no amount, account, date, mapping, OCR or import-override flow.
Other files in the selection continue normally. A selection containing only
annual summaries offers Back to Home and creates no financial records.

Direct native-pipeline and generic-reader calls also guard against treating the
totals as transactions, including when manual dates or generic correction are
requested. No account, statement, balance, transaction or transfer is created
from this read-only result. Source metadata and PDFs remain transient in the live
import, with no database migration or changes to saved history. Parser provenance
advances to 2.2.6.

Fictional fixtures cover side-by-side dates and totals, wrapped ranges, separate
issue dates, missing/conflicting dates, genuine detailed ledgers, unread pages,
zero database writes and mixed-file imports. Mobile Chromium/WebKit tests verify
the displayed dates, absence of correction controls, preserved monthly totals
and zero annual-summary records. Real statements are checked only locally and
never committed to Git or uploaded to the deployed application.
