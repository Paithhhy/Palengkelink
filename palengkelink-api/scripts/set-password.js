// Set a user's password from the terminal:  npm run set-password -- <username> <new password>
// Use it once after loading 005_seed.sql (the seed only has REPLACE_BCRYPT placeholders), or when someone is locked out.
require("dotenv").config();
const bcrypt = require("bcryptjs");
const { prisma, asUser } = require("../src/db");

(async () => {
  const [username, password] = process.argv.slice(2);
  if (!username || !password || password.length < 8) {
    console.error("Usage: npm run set-password -- <username> <new password (8+ characters)>");
    process.exit(1);
  }
  const hash = await bcrypt.hash(password, 10);
  const n = await asUser({ role: "admin", id: "" }, (tx) =>
    tx.$executeRaw`UPDATE users SET password_hash = ${hash}, status = 'active' WHERE username = ${username}`);
  console.log(n ? `Password set for "${username}".` : `No user called "${username}".`);
})()
  .catch((e) => { console.error(e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
