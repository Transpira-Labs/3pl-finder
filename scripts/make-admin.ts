import { config } from "dotenv";
config();

import { getUserByEmail, createUser, setUserRole } from "../src/lib/auth/users";

/**
 * Bootstrap / promote an admin. New signups default to role "none", so the very
 * first admin has to be created here.
 *
 *   npx tsx --env-file=.env scripts/make-admin.ts <email> [password]
 *
 * - If the user exists, promote them to admin.
 * - If not, create them as admin (password required).
 */
async function main() {
  const email = process.argv[2]?.toLowerCase().trim();
  const password = process.argv[3];
  if (!email) {
    console.error("Usage: make-admin.ts <email> [password]");
    process.exit(1);
  }

  const existing = await getUserByEmail(email);
  if (existing) {
    await setUserRole(existing.id, "admin");
    console.log(`✅ Promoted ${email} to admin.`);
  } else {
    if (!password) {
      console.error(`No account for ${email}. Provide a password to create one:`);
      console.error(`  npx tsx --env-file=.env scripts/make-admin.ts ${email} <password>`);
      process.exit(1);
    }
    await createUser({ email, password, role: "admin" });
    console.log(`✅ Created admin ${email}.`);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
