# Dream Japan 4.5 deployment guide

The package contains full `index.html`, `style.css`, and `script.js` files based on the existing site sources, plus Firestore rules and indexes. The Firebase project and GitHub Pages deployment were not changed. Keep your repository's media, `CNAME`, manifest, icons and service worker and review the rollout steps below.

## What changed

- Login uses one profile read, with an account-scoped cached shell for returning users. The dashboard can render before catalogue metadata arrives. The initial load skips the question bank, leaderboard, result history, premium plans and requests.
- Public catalogue and payment settings use a five-minute IndexedDB cache when available. Sensitive question banks are held in an eight-set, user-scoped memory cache and fetched from the server on cache miss. Starting, resuming and reviewing an exam recheck the live publication and membership settings before using cached content. The tab stores its own resumable exam checkpoint and clears it on logout. Progress statistics and leaderboard fetch only on demand.
- Students opens with a Firestore limit of five. See All uses those five rows plus up to 15 new documents for page one and 20 per subsequent page. Searches run after 400 ms and query an index across the whole directory. The app confirms exact substrings across name, email, student note and premium note. For long terms, a matching three-character candidate can be a false positive, so an exact-match page may have fewer than 20 rows. Use Next to continue. Active/blocked/premium/expired/recently online/premium started today use database filters, and Nepal time defines Today. Admin totals use count aggregations. Requests and reports also load in pages.
- Questions accepts the existing field names and compact rows, with optional `marks` and `explanation`. Import/export and editor actions target the chosen group and set. Bulk import changes only the sets represented in the JSON. Edits update question counts and versions atomically with the question document.
- Existing October–November identifiers and leaderboard are preserved. December–January has a separate leaderboard for the six new sets. The public set number stays 1–6 in each group. Both groups support free/premium access, names, duration, total marks, pass marks, display order and individual publication.
- New result summaries store scores and per-question answer outcomes. Full new review snapshots are saved under a separate protected document and fetched only when needed. Existing result, leaderboard and history documents are kept. The app still displays legacy latest attempts where a replacement result is missing.

## Firestore deployment

1. Confirm your project is `dream-japan-9cad8`. Back up the current GitHub source and any rules/indexes already deployed. If your project has indexes outside this package, merge them into the supplied configuration and retain them when the CLI asks about deletion. Inspect the legacy bank for its actual array field. The index exemption covers `questions`; if the existing field has another name, opt it out of indexing in the console if it is not queried.
2. Test the package in an emulator or staging project with test users and copied sample data. For the emulator, run `firebase emulators:start --only auth,firestore --project demo-dream-japan` with the Firebase CLI and Java installed, then point a test copy of the app's Firebase SDK at those emulators. Test the permission matrix below before production.
3. Deploy the Firestore configuration using `firebase deploy --only firestore:rules,firestore:indexes --project dream-japan-9cad8` from the extracted folder. If deploying manually, publish `firestore.rules` in Firestore Database → Rules, then create the listed composite indexes and field exemptions. Wait until the indexes show Enabled. No Cloud Functions or paid search service is required.
4. Replace the complete HTML, CSS and JS in the GitHub Pages repository. Commit to your normal Pages branch. Keep paths, media and icon assets in place. If your existing service worker uses a fixed cache version or an offline-first navigation response, bump its cache or require a network refresh for page navigation so browsers receive the new HTML before you split the bank. Verify fresh and returning browser sessions. Do not split while the previous frontend is still serving students.
5. In Admin Dashboard → Settings, click **Back up original October–November bank** and store the exported JSON safely. The operation backs up the question data as JSON; keep the untouched original Firestore document as the primary rollback copy. Verify the file is readable and count the source questions per set. Click **Split October–November bank** once. The transaction reads the original and checks that all six targets are empty. It copies the six sets and publishes the switch in a single commit, preserving existing publication defaults. It leaves the original intact. Check the six counts, question order, old bookmarks and an existing student's previous results before allowing edits.
6. In the same Settings screen click **Build student search index** and keep the tab open until it reports ready. The backfill reads and rechecks existing profiles in pages of up to 100. It updates only search metadata and fills missing registration dates from last login or the Unix epoch. It can be rerun. Schedule it away from peak use if your collection is large, and consult Firestore Usage for the one-time read/write cost. Until it completes, older unindexed users may be absent from the student pages and counts. New registrations index themselves. The owner account is excluded from student pages.
7. Choose **December – January** in Settings → Export / Import. Paste the existing array format or a JSON object with a `questions` array and click Import questions. Rows use group-local `set` numbers 1–6 even though Firestore stores internal IDs 7–12. If `set` is omitted in an object row, its target is the selected set. Use the set selector to export and verify each set before publishing. Edit name, duration, marks, access and display order in Settings, then publish the intended sets one at a time.
8. Test one active free account, one active premium account, one expired or blocked account and the verified admin. Check Android Chrome, iPhone Safari and desktop with the real audio/image URLs. Open a fresh browser tab to validate catalogue, index and security-rule deployment.

**Rollback.** Before a split, the previous frontend can still read the legacy document under these rules. After the split, the previous frontend cannot read that bank for students. To restore the old frontend, first back up the twelve per-set documents and the catalogue. Then set `appConfig/mockTests.legacySplit` to `false` using admin access and deploy the previous frontend. The original October–November bank becomes available under the legacy premium policy. If you changed individual publication or access after the split, restore that policy explicitly before switching students back; legacy mode cannot enforce per-set publication. Leave the individual-set, result, leaderboard, request and audit documents in place. A rollback does not copy later question edits back into the original bank. Compare these versions before a later rollout.

## December–January configuration

All six start unpublished and premium by default, with 60 minutes, 250 total marks and a 200-mark pass. The first Settings save, upload or legacy split writes the relevant catalogue entries. The frontend defaults are available before any December data is present.

| Display number | Set name | Question document |
|---|---|---|
| 1 | SIFU | `jftdecjanset/set_7` |
| 2 | OKIMAS | `jftdecjanset/set_8` |
| 3 | KUTCHUSITA | `jftdecjanset/set_9` |
| 4 | KUROI | `jftdecjanset/set_10` |
| 5 | KHUDAMONO | `jftdecjanset/set_11` |
| 6 | JITENSYA | `jftdecjanset/set_12` |

### Data and fields

| Path | Purpose |
|---|---|
| `appConfig/mockTests` | `legacySplit` plus a `sets` map keyed by internal set ID. Entries contain `name`, `duration`, `totalMarks`, `passMarks`, `order`, `access`, `isPublished`, `version` and `questionCount`. |
| `jftoctnovset/QORwII8D7qLZ7wuCDW36` | Unchanged source bank. Admin-only after the split. |
| `jftoctnovset/set_1` through `set_6` | October–November bank documents, with `questions`, `version` and `updatedAt`. |
| `jftdecjanset/set_7` through `set_12` | December–January bank documents with the same fields. Created on upload. |
| `users/{uid}` | Existing profile plus `directoryStudent` and `searchGrams`. |
| `users/{uid}/latestResults/{setId}` | Latest result per set and optional `passMarks`. Old `results` records remain. |
| `users/{uid}/resultReviews/{setId}` | Protected latest review snapshot, tied to the latest attempt ID. |
| `leaderboard/{uid}` and `leaderboardDecJan/{uid}` | Existing October board and new December board. Results are browser-reported practice scores. |

`mock-test-defaults.json` is a reference for field names and types. The admin UI initializes this data. Do not overwrite a live catalogue with this file.

## Documents versus reads

| Storage model | Data reads for one 50-question set | Trade-off |
|---|---:|---|
| One bank document | 1 | Transfers every set; cannot enforce individual publication inside one document; approaches the 1 MiB document limit quickly. |
| One document per set | 1 | Selected set only, small catalogue and per-set authorization. An edit rewrites one set. This package uses this model with a 700,000-byte JSON guard; Firestore applies its own final size calculation. |
| Multiple batches per set | Number of batches | Good if an individual set grows large. Each batch adds a read and must enforce the parent access/version. |
| One document per question | Around 50 | Fine-grained editing, but an ordinary full exam downloads and bills roughly 50 question documents. |

Sample reads below are calculations, not measurements from your production Firebase project. Billed rules dependencies and index entries can change counts. Empty queries generally have a minimum charge of one read. Firestore bills aggregation index entries in batches of up to 1,000 and normally charges for documents consulted by security rules.

| Scenario | Before | After |
|---|---:|---:|
| Premium login, assuming 4 plans, 3 saved results, a full leaderboard top 20 and an existing device binding | About 33–34 reads before presence/listener refresh effects | 2 cold (profile and catalogue), or 1 when the public catalogue cache is fresh |
| Admin opens Students with 1,000 indexed student profiles | About 1,000 if the overview did not already warm that collection | 5 student documents |
| Admin clicks See All right after the first five load | 1,000 total for the old approach | 15 additional documents, reaching 20. Subsequent pages fetch up to 20; recently cached pages reuse their results. |
| Set detail opens | Previously funded by login's bulk fetches | 1 fresh catalogue read on selection plus 1 latest-result document read; October legacy fallback may add a query and count if needed |
| Premium member starts a split set | Shared bank can be reused briefly, but the original code rechecks the user and device in both start and activation | About 6 on a cold start including the catalogue/profile/device and two potential bank-rule dependencies; about 3 when the bank is already in authorized memory |
| Active student selects an unpublished set | No per-set state | 1 live catalogue read on click, zero question or media reads |
| Browsing 50 questions inside an authorized exam | 0 further question-document reads once loaded | 0 further question-document reads once loaded |

The Spark quota is 50,000 document reads and 20,000 writes per day for the free database. The existing recent-online badge still uses throttled presence writes while students are active. Review Usage during busy periods. Answer submission continues to read up to six latest result documents for its series in a transaction and checks leaderboard updates in rules. This preserves consistency across tabs. Question media hosted in the public GitHub repository are independently public if someone already knows the URLs. Changes to publication stop new private question/review reads and new starts, but cannot recall questions/media already delivered to a browser or remove old question text from historical result documents that you retain.

## Permission and regression checklist

| Test | Expected behavior |
|---|---|
| Signed-out direct bank get or collection list | Denied. |
| Active free student reads a published free set by document ID | Allowed. |
| Active free student reads a premium bank, or blocked user reads a bank | Denied. |
| Premium student reads an unpublished bank or the shared bank after the split | Denied. |
| Non-admin writes premium status, publication state, or a bank | Denied. |
| Unpublish a cached set and retry | Coming Soon. No question or media fetch. |
| Edit a cached set, then retake | Latest catalogue version selects the updated bank. |
| Premium student opens an old set and previous results | Same set number and latest attempt, with legacy fallback when needed. |
| Admin opens Students, then browses, searches, grants premium and checks reports | Five initial documents, indexed searching, cursor navigation and the existing actions. |

Verified locally with JavaScript syntax checks and mocked Firestore/DOM tests covering six set names, default unpublished status, access gate, file selection, marks, cache invalidation, result identifiers, search normalization and five-to-twenty student pagination. The checks did not run against the live Firebase project, Firebase Rules emulator, Android or iPhone. Use the staging tests before deploying.

Firebase references

- [Firestore pricing and rule-dependent reads](https://firebase.google.com/docs/firestore/pricing)
- [Firestore limits and Spark quota](https://firebase.google.com/docs/firestore/quotas)
- [Firestore Security Rules conditions](https://firebase.google.com/docs/firestore/security/rules-conditions)
- [Managing Firestore indexes](https://firebase.google.com/docs/firestore/query-data/indexing)
