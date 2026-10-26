// Turn off two-step sign-in from the terminal:  npm run two-step-off -- <username>
// For when the emailed code cannot arrive (email settings broken, or the person lost their email) and no admin can
// sign in to do it on the Accounts page.
require("dotenv").config();
const { prisma } = require("../src/db");

(async () => {
  const [username] = process.argv.slice(2);
  if (!username) {
    console.error("Usage: npm run two-step-off -- <username>");
    process.exit(1);
  }
  const [u] = await prisma.$queryRaw`SELECT * FROM fn_login_lookup(${username})`;
  if (!u) return console.log(`No user called "${username}".`);
  await prisma.$executeRaw`SELECT fn_set_two_factor(${u.user_id}::int, false, NULL::int)`;
  console.log(`Two-step sign-in is off for "${username}". They can sign in with the password only.`);
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
