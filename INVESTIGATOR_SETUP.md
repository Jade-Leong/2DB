# Loop Market local development

Loop Market is a fictional shopping marketplace. All purchases and funds are simulated.

Requires Node.js 24+. In PowerShell, enter this project folder and run:

```powershell
npm.cmd ci
npm.cmd run reset
npm.cmd run dev
```

Open http://127.0.0.1:5173. Stop the app with Ctrl+C. `npm.cmd run build` type-checks and builds the UI; `npm.cmd start` serves that build at http://127.0.0.1:3001.

Use the clearly labeled local-only demo account selector. Maya Chen and Jamie Rivera are buyers. Olive Brooks and Theo Park are sellers. The selector is a deliberate local impersonation mechanism; permissions are enforced relative to the selected server-resolved account.

The API uses `X-Demo-Account`. Source is in `src/` and `server/`; seed photos are under `public/images/`. SQLite and uploaded images are created under `data/local/`. All prices and payments use integer cents.

To reset a scenario, stop the app, run `npm.cmd run reset`, restart, and use a fresh private browser window. Reset removes only local demo records and uploaded files, then restores the seed accounts and products.

Work only on the assigned customer requirement. Submit changes for human review. Do not approve, merge, or deploy your own work.
