# PalengkeLink API

Express (API layer) + Prisma (database connection) + PostgreSQL on Neon, deployed on Vercel.
The website in `public/` talks to this API; the API talks to the database as the logged-in user's database role.

## Run it on your computer
1. Install Node.js 20+. In this folder run `npm install` then `npx prisma generate`.
2. Create the database on Neon and run `database/001` to `005` in the SQL Editor, in order.
3. Copy `.env.example` to `.env` and fill it in (use the **palengkelink_app** user, never the owner).
4. Put real bcrypt hashes in `005_seed.sql` (or create users through `POST /api/vendors`).
5. `npm run dev` then open http://localhost:3000

## Folder guide
| Path | What it does |
|---|---|
| `src/index.js` | Starts Express, mounts the webhook, the website and the API |
| `src/routes/index.js` | Every URL, who may use it, which controller runs |
| `src/controllers/` | The work for each URL (auth, admin, payments, my = vendor self-service) |
| `src/middleware/auth.js` | Login token check + role check |
| `src/db.js` | `asUser()` = run a transaction as `app_admin`, `app_staff` or `app_vendor` |
| `src/paymongo.js` | Create PayMongo checkout + verify webhook signature |
| `src/errors.js` | Turns database errors into clean JSON (no crashes) |
| `database/` | Migration scripts 001 to 006 |
| `public/` | The website (still using sample data until you connect it) |

## PayMongo
1. Add `PAYMONGO_SECRET_KEY` (test key first) and `APP_URL` to the environment.
2. Register ONE webhook in the PayMongo dashboard: `https://YOUR-APP.vercel.app/api/webhooks/paymongo`, event `checkout_session.payment.paid`. Copy its signing secret (`whsk_...`) into `PAYMONGO_WEBHOOK_SECRET`.
3. Vendor flow: `POST /api/my/payments/:id/checkout` returns `checkoutUrl`; redirect the vendor there. PayMongo then calls the webhook and the database marks the bill paid.

## Deploy to Vercel
Push to GitHub (through a Pull Request), import the repo in Vercel, add the environment variables from `.env.example`, deploy. Use Neon's pooled connection string. Then register the webhook URL above.

## Main endpoints
Login `POST /api/auth/login`. Admin/staff: dashboard, vendors, stalls, inspections, maintenance. Admin: payments, products, suppliers, audit, assignments. Vendor: everything under `/api/my/...`. See `src/routes/index.js`.

## Checklist before the defense
- `.env` is NOT on GitHub and uses `palengkelink_app`
- Change the placeholder password in `database/004_security.sql`
- Every member can explain `asUser()`, one controller, and one trigger line by line
