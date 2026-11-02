# v4.0.0: Firestore-only edition

The previous edition relied on callable Cloud Functions. The user's project has not upgraded to use Functions, so premium requests, approval, membership changes and exam start could not reach an available backend.

This edition removes every Cloud Functions import/call from the website. It uses Firestore transactions for deterministic premium requests, admin approval, custom membership changes, browser preferences and result/leaderboard saving. The deployment configuration includes only Firestore rules. The package excludes the old server functions folder.

The new rules allow students to submit their own validated payment request and save bounded practice results, while premium and status remain admin-controlled. Active paid membership is checked in rules before question reads. Each user can read their own private history; leaderboard documents contain only display information. Admin notices now start with background initialization. HTML asset versions and the service worker cache version were updated to avoid loading the old Functions-dependent script.

The previous redesigned pages, custom premium days, question filters/previews/reordering/bulk deletion, bookmarks, media player/preloading/layout, 250-point scoring and PWA remain available.

The security tradeoffs are explicit: one-browser behavior is enforced by the cooperative frontend, not cryptographic hardware identity; scores are browser-reported rather than server-verified. This edition is intended for practice tests. See README.md.

Validation: 12 mocked transaction tests passed, JavaScript syntax passed, and the exam flow opened in a local browser fixture. Live rules and Firebase behavior still require checking after the user publishes the supplied rules and uploads the new files.
