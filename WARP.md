# WARP.md

This file provides guidance to WARP (warp.dev) when working with code in this repository.

Repository overview
- Node.js project using Playwright to automate WhatsApp Web.
- Single entry point: index.js (CommonJS). No build system, no tests, no linter configured.

Commands
- Install dependencies (recommended for lockfile reproducibility):
  - npm ci
  - npx playwright install
- Run the script (set phone numbers in E.164 without +):
  - PowerShell: $env:WA_PHONE_A="905519576423"; $env:WA_PHONE_B="905514874681"; node index.js
  - POSIX shells: WA_PHONE_A=905519576423 WA_PHONE_B=905514874681 node index.js
- Lint/format: not configured.
- Tests: not configured (npm test currently exits with error).

High-level architecture
- Configuration
  - CONFIG object in index.js controls runtime: phone numbers (via env WA_PHONE_A/WA_PHONE_B), persistent user-data dirs, headless toggle, daily min/max exchanges, and randomized delays.
  - On first run, you must scan WhatsApp Web QR for each profile; sessions persist under user-data/accountA and user-data/accountB.
- Browser/session lifecycle
  - Launches two persistent Chromium contexts (one per account) with automation flags minimized.
  - Opens reciprocal chats using https://web.whatsapp.com/send?phone=<905519576423>.
  - waitForLogin() loops until logged-in UI is detected before proceeding.
- Messaging loop (core behavior)
  - Builds a ~400-item Turkish message pool plus short replies at startup.
  - Repeatedly performs “exchanges”: A sends a randomized message to B; after a human-like delay, B replies (short or full) to A.
  - Humanization via random per-character typing delays, randomized gaps between messages and exchanges, and minor stabilization waits around composer interactions.
  - Logs last incoming/outgoing message text for basic observability.
  - Enforces a daily exchange target (randomized between configured min/max) and sleeps until local midnight once reached, then resets counters.
- DOM interaction
  - Message composer is resolved by trying several candidate selectors to be resilient to UI changes.
  - Messages are sent by focusing the composer, typing with delays, and pressing Enter.
- Shutdown handling
  - SIGINT handler gracefully closes both browser contexts before exit.

Project-specific notes
- The script creates user-data/ directories automatically; do not delete them unless you want to re-scan QR codes.
- If browsers are missing, run npx playwright install (already listed above).
