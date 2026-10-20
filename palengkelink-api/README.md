# PalengkeLink

Express (API layer) + Prisma (database connection) + PostgreSQL on Neon, deployed on Vercel.
The website in `public/` talks to this API; the API talks to the database as the logged-in user's database role.

## Who can do what
| Role | Can do |
|---|---|
| Admin | Everything: vendors, stalls (number, section, rent, condition, who rents it), bills + cash payments, product catalog, suppliers, inspections, maintenance status, user accounts, approve / decline supplier suggestions, Activity log (on the Account page) |
| Staff / inspector | Stalls (section, under-maintenance), record + edit inspections, maintenance status |
| Vendor | My stalls (section, rent, renting since, unpaid balance, report a problem), own profile (picture, cover, about), own products (add, edit price/stock/supplier, remove), report + edit maintenance problems, suggest suppliers (Products page), pay rent online (PayMongo) |
| Everyone | Market Directory: view every active vendor's profile; change own password |

## Folder guide
| Path | What it does |
|---|---|
| `src/index.js` | Starts Express, mounts the webhook, the website and the API |
| `src/routes/index.js` | Every URL, who may use it, which controller runs |
| `src/controllers/` | The work for each URL (auth, admin, payments, my = vendor self-service, profiles = directory) |
| `src/middleware/auth.js` | Login token check + role check |
| `src/db.js` | `asUser()` = run a transaction as `app_admin`, `app_staff` or `app_vendor` |
| `src/paymongo.js` | Create PayMongo checkout + verify webhook signature |
| `src/errors.js` | Turns database errors into clean JSON (no crashes) |
| `scripts/set-password.js` | Set any user's password from the terminal |
| `database/` | Migration scripts (006 = benchmark queries for the report) |
| `src/mailer.js` | Sends email (password reset links) through SMTP |
| `public/` | The website: sign in / register / reset, dashboards, edit forms, vendor profiles |
| `public/img/market.jpg` | Background photo by Antonio Araujo on Unsplash (free to use under the Unsplash license) |

## Registration and "Forgot password"
- **Register** (on the sign-in page): vendors and inspectors create their own account (admins are only made by an admin; run `database/010` first). It starts as *pending*; the admin approves or declines it on the Dashboard or the Accounts page. Pending accounts cannot sign in.
- **Forgot password**: the person enters their email and gets a 6-digit verification code plus a reset link (run `database/011` first). They type the code on the sign-in page with a new password, or open the link. Both work once, for 30 minutes; 5 wrong codes and a new code is needed. Only hashes of the code (HMAC with `JWT_SECRET`) and of the link token (SHA-256) are stored.
- **Activity log**: admins see the last 200 changes (who, what, when, which fields) at the bottom of the Account page. Other roles cannot see it, and `/api/audit` is admin-only.
- **Search**: Vendors, Stalls, Inspections, Maintenance, Directory, Accounts and the Activity log always have a search box. Type several words to find rows that contain all of them.
- Email is sent through SMTP (settings `SMTP_*` and `MAIL_FROM` in `.env.example`). For Gmail: turn on 2-Step Verification, create an *App Password*, and use `smtp.gmail.com`, port `587`. Without `SMTP_HOST`, the email is printed in the terminal running `npm start`, which is handy for testing.
- The seed accounts use `@palengkelink.test` emails. Change them to real addresses (Accounts → Edit) before testing the email.

## PayMongo
1. Add `PAYMONGO_SECRET_KEY` (test key first) and `APP_URL` to the environment.
2. Run `database/009_paymongo_sync.sql` in Neon.
3. Vendor flow: Payments → **Pay** button → PayMongo page (GCash / card) → back to the site. On return, the site asks PayMongo whether the checkout was paid and marks the bill paid (this works on localhost too).
4. After deploying, also register the webhook so bills are marked paid even if the vendor closes the tab before returning:
   `npm run paymongo-webhook -- https://YOUR-APP.vercel.app`, then put the printed `whsk_...` secret in `PAYMONGO_WEBHOOK_SECRET` (in Vercel too) and redeploy.
5. Test card (test mode): `4343 4343 4343 4345`, any future expiry date, any CVC. Test GCash: click "Authorize Test Payment".
