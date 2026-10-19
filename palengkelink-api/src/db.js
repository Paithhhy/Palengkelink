// Database connection. The app logs in as palengkelink_app (limited user) and, for each request,
// switches to the role of the logged-in person: app_admin / app_staff / app_vendor / app_gateway.
const { PrismaClient } = require("@prisma/client");

const prisma = global.prisma || new PrismaClient();   // reuse one client between requests on Vercel
if (process.env.NODE_ENV !== "production") global.prisma = prisma;

const ALLOWED_ROLES = ["admin", "staff", "vendor", "gateway"];

/**
 * Run database work as a specific user.
 * - SET LOCAL ROLE      -> PostgreSQL itself enforces what this role may read/write.
 * - app.current_user_id -> used by the vendor views and by the audit trigger.
 * Both settings last only for this one transaction.
 */
async function asUser(user, work) {
  if (!ALLOWED_ROLES.includes(user.role)) throw new Error("Unknown role");
  return prisma.$transaction(async (tx) => {
    // set_config('role', ..., true) is the same as SET LOCAL ROLE; doing both in one query saves a trip to the database.
    await tx.$executeRaw`SELECT set_config('role', ${"app_" + user.role}, true),
                                set_config('app.current_user_id', ${String(user.id ?? "")}, true)`;
    return work(tx);
  }, {
    maxWait: 15000,   // wait up to 15 s for a free connection (Neon may be waking up / far away); Prisma's default is 2 s
    timeout: 20000,   // the whole transaction may take up to 20 s; default is 5 s
  });
}

module.exports = { prisma, asUser };
