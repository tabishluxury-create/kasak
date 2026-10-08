# HisabAI

HisabAI is a browser-only bookkeeping app. Accounts, sign-in state, settings,
and business records are saved in this browser's local storage. There is no
application backend, server-side account, or cross-device synchronization.

## Open the app

Open `login.html` in a browser, or publish these static files on a static
website host. No Python server, database, Docker, or API service is needed.
The app does not send account or business data to a server.

Browser data belongs to the browser profile and website origin where it was
created. It will not automatically appear on another device, in another
browser, or on a different origin. Clearing browser/site data can permanently
remove it. Use the in-app **Download backup** action regularly and keep the
backup somewhere safe; use **Restore backup** to recover it in this browser.

PIN and password verifiers are stored in browser storage. This provides
convenient local sign-in, not server-grade protection: someone with access to
the browser profile or developer tools can access or alter local data. Do not
treat this app as secure storage for confidential records on a shared device.

Existing records already stored in this browser remain under their
browser-storage keys. Accounts and records that existed only in the deleted
SQLite backend are not available to the browser-only app; they must first be
exported from a still-running backend and restored in the browser if a backup
is available.
