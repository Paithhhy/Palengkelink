# PalengkeLink

Express (API layer) + Prisma (database connection) + PostgreSQL on Neon, deployed on Vercel.
The website in `public/` talks to this API; the API talks to the database as the logged-in user's database role.

## Run it on your computer
1. Install Node.js 20+. In this folder run `npm install`.
2. Create the database on Neon and run these in the SQL Editor, in order: `database/001` to `005`, then `007`, `008`, `009`, `010`, `011`, `012` and `013`.
   (Already ran the earlier ones? Just run the ones you have not run yet, in order.)
3. Copy `.env.example` to `.env` and fill it in (use the **palengkelink_app** user, never the owner).
4. Give the sample accounts real passwords (the seed only has placeholders):
   `npm run set-password -- admin YourPassword1`, and the same for `ramos` (inspector), `nena` and `berto` (vendors).
5. `npm run dev` then open http://localhost:3000 and sign in.

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
- Email is sent through SMTP (settings `SMTP_*` and `MAIL_FROM` in `.env.example`). For Gmail: turn on 2-Step Verification, create an *App Password*, and use `smtp.gmail.com`, port `587`. Without `SMTP_HOST`, the email is printed in the terminal running `npm start`, which is handy for testing. On Vercel, add the same `SMTP_*`, `MAIL_FROM` and `APP_URL` (your https://….vercel.app address) under Settings → Environment Variables and redeploy; for testing, set `MAIL_ONLY_TO` to your own email and every email goes only to you (the subject shows who it was for). The server uses `waitUntil` from `@vercel/functions` so Vercel finishes sending the email after the page has its answer.
- **Mailtrap (official `mailtrap` SDK) instead of SMTP**: set `MAILTRAP_TOKEN` (Mailtrap → Settings → API Tokens). With `MAILTRAP_INBOX_ID` (the number in the inbox URL) emails go to that Mailtrap test inbox; without it they are really delivered through Mailtrap Email Sending (`MAIL_FROM` must use your verified domain). `MAIL_ONLY_TO` works here too. No domain yet? Use `MAIL_FROM="Mailtrap Test <hello@demomailtrap.co>"`: the demo domain only delivers to your own Mailtrap account email. Sent emails are listed at https://mailtrap.io/sending/email_logs.
- Email is sent through SMTP (settings `SMTP_*` and `MAIL_FROM` in `.env.example`). For Gmail: turn on 2-Step Verification, create an *App Password*, and use `smtp.gmail.com`, port `587`. Without `SMTP_HOST`, the email is printed in the terminal running `npm start`, which is handy for testing. On Vercel, add the same `SMTP_*`, `MAIL_FROM` and `APP_URL` (your https://….vercel.app address) under Settings → Environment Variables and redeploy; for testing, set `MAIL_ONLY_TO` to your own email and every email goes only to you (the subject shows who it was for). The server uses `waitUntil` from `@vercel/functions` so Vercel finishes sending the email after the page has its answer.
- **Mailtrap (official `mailtrap` SDK) instead of SMTP**: set `MAILTRAP_TOKEN` (Mailtrap → Settings → API Tokens). With `MAILTRAP_INBOX_ID` (the number in the inbox URL) emails go to that Mailtrap test inbox; without it they are really delivered through Mailtrap Email Sending (`MAIL_FROM` must use your verified domain). `MAIL_ONLY_TO` works here too. No domain yet? Use `MAIL_FROM="Mailtrap Test <hello@demomailtrap.co>"`: the demo domain only delivers to your own Mailtrap account email. Sent emails are listed at https://mailtrap.io/sending/email_logs.
- The seed accounts use `@palengkelink.test` emails. Change them to real addresses (Accounts → Edit) before testing the email.

## Security
| Protection | How |
|---|---|
| Passwords | bcrypt hashes only. New passwords: 8+ characters with letters and numbers, not a well-known password, not the username |
| Guessing passwords | 20 sign-in tries per IP per 15 minutes, and 10 wrong passwords in a row lock that account for 15 minutes (`database/013`) |
| Stolen login token | Every request checks with the database that the account is still active and the token is current. Changing or resetting a password, an admin disabling the account, or **Account → Log out of all devices** ends all its sessions at once |
| Who did what | Every change and every sign-in, wrong password and lock is in the Activity log (admins, Account page) |
| SQL injection | Every query uses parameters; the app connects as a limited database user and switches to `app_admin` / `app_staff` / `app_vendor`, so PostgreSQL itself blocks what a role may not do |
| Injected scripts (XSS) | All text is escaped, a strict Content-Security-Policy only runs our own `app.js`, profile pictures must be real JPEG/PNG/WebP images |
| Clickjacking, caching | The site cannot be shown inside another site, API answers are never cached |
| Flooding | At most 300 API requests a minute per IP |
| Payments | PayMongo webhooks are signature-checked; amounts are re-checked in the database |

**Keep it safe:** `JWT_SECRET` must be long and random (create one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) and different on Vercel; never commit `.env`; give admin accounts strong passwords; check the Activity log for "Wrong password" / "Account locked" rows. On Vercel the per-IP limits count per server instance, so for heavy attacks also turn on Vercel Firewall / Attack Challenge Mode.

## Security
| Protection | How |
|---|---|
| Passwords | bcrypt hashes only. New passwords: 8+ characters with letters and numbers, not a well-known password, not the username |
| Guessing passwords | 20 sign-in tries per IP per 15 minutes, and 10 wrong passwords in a row lock that account for 15 minutes (`database/013`) |
| Stolen login token | Every request checks with the database that the account is still active and the token is current. Changing or resetting a password, an admin disabling the account, or **Account → Log out of all devices** ends all its sessions at once |
| Who did what | Every change and every sign-in, wrong password and lock is in the Activity log (admins, Account page) |
| SQL injection | Every query uses parameters; the app connects as a limited database user and switches to `app_admin` / `app_staff` / `app_vendor`, so PostgreSQL itself blocks what a role may not do |
| Injected scripts (XSS) | All text is escaped, a strict Content-Security-Policy only runs our own `app.js`, profile pictures must be real JPEG/PNG/WebP images |
| Clickjacking, caching | The site cannot be shown inside another site, API answers are never cached |
| Flooding | At most 300 API requests a minute per IP |
| Payments | PayMongo webhooks are signature-checked; amounts are re-checked in the database |

**Keep it safe:** `JWT_SECRET` must be long and random (create one with `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`) and different on Vercel; never commit `.env`; give admin accounts strong passwords; check the Activity log for "Wrong password" / "Account locked" rows. On Vercel the per-IP limits count per server instance, so for heavy attacks also turn on Vercel Firewall / Attack Challenge Mode.

## PayMongo
1. Add `PAYMONGO_SECRET_KEY` (test key first) and `APP_URL` to the environment.
2. Run `database/009_paymongo_sync.sql` in Neon.
3. Vendor flow: Payments → **Pay** button → PayMongo page (GCash / card) → back to the site. On return, the site asks PayMongo whether the checkout was paid and marks the bill paid (this works on localhost too).
4. After deploying, also register the webhook so bills are marked paid even if the vendor closes the tab before returning:
   `npm run paymongo-webhook -- https://YOUR-APP.vercel.app`, then put the printed `whsk_...` secret in `PAYMONGO_WEBHOOK_SECRET` (in Vercel too) and redeploy.
5. Test card (test mode): `4343 4343 4343 4345`, any future expiry date, any CVC. Test GCash: click "Authorize Test Payment".
