const mainPrisma = require("./src/config/prisma");
const { getTenantClient } = require("./src/config/tenantManager");
const dotenv = require("dotenv");

dotenv.config();

async function migrate() {
  console.log("🚀 Starting production wallet and customer migration...");

  try {
    // 1. Fetch all tenants from main database
    const tenants = await mainPrisma.tenant.findMany();
    console.log(`Found ${tenants.length} tenants in main registry.`);

    for (const tenant of tenants) {
      console.log(`\nProcessing tenant: ${tenant.name} (${tenant.slug})`);
      const tenantDb = getTenantClient(tenant.dbUrl);

      // Check if Wallet table exists in tenant DB by running a test query
      let wallets = [];
      try {
        wallets = await tenantDb.$queryRaw`SELECT * FROM "Wallet";`;
        console.log(`Found ${wallets.length} local wallets in tenant DB.`);
      } catch (err) {
        console.log(`No local Wallet table found/accessible in ${tenant.name} database. Skipping.`);
        continue;
      }

      if (wallets.length === 0) continue;

      // Fetch users and transactions
      const users = await tenantDb.$queryRaw`SELECT id, phone, email, name, "avatarUrl" FROM "User";`;
      const userMap = new Map(users.map(u => [u.id, u]));

      let rawTransactions = [];
      try {
        rawTransactions = await tenantDb.$queryRaw`SELECT * FROM "WalletTransaction";`;
      } catch (err) {
        console.log(`No local WalletTransaction table found.`);
      }

      const txMap = new Map();
      for (const tx of rawTransactions) {
        if (!txMap.has(tx.walletId)) {
          txMap.set(tx.walletId, []);
        }
        txMap.get(tx.walletId).push(tx);
      }

      // 2. Migrate each local wallet
      for (const localWallet of wallets) {
        const user = userMap.get(localWallet.userId);
        if (!user || (!user.phone && !user.email)) {
          console.log(`Skipping wallet ${localWallet.id} (user has no phone/email).`);
          continue;
        }

        // Clean user info
        const phone = user.phone.trim();
        const email = user.email ? user.email.trim() : null;
        const name = user.name ? user.name.trim() : "Walk-in Customer";
        const avatarUrl = user.avatarUrl || null;

        console.log(`Migrating wallet for user: ${name} (Phone: ${phone}) - Points: ${localWallet.points}`);

        // 2a. Find or create AppUser in main database
        let appUser = await mainPrisma.appUser.findUnique({
          where: { phone }
        });

        if (!appUser && email) {
          appUser = await mainPrisma.appUser.findUnique({
            where: { email }
          });
        }

        if (!appUser) {
          appUser = await mainPrisma.appUser.create({
            data: {
              phone,
              email,
              name,
              avatarUrl,
            }
          });
          console.log(`Created new global AppUser for ${name}.`);
        }

        // 2b. Upsert global Wallet for this AppUser
        const globalWallet = await mainPrisma.wallet.upsert({
          where: { appUserId: appUser.id },
          create: {
            appUserId: appUser.id,
            points: localWallet.points,
            lifetimeEarn: localWallet.lifetimeEarn,
            tier: "bronze",
            createdAt: localWallet.createdAt,
            updatedAt: localWallet.updatedAt
          },
          update: {
            points: { increment: localWallet.points },
            lifetimeEarn: { increment: localWallet.lifetimeEarn }
          }
        });

        // 2c. Migrate transactions
        const walletTxs = txMap.get(localWallet.id) || [];
        for (const tx of walletTxs) {
          // Check if transaction already copied
          const exists = await mainPrisma.walletTransaction.findFirst({
            where: {
              walletId: globalWallet.id,
              points: tx.points,
              createdAt: tx.createdAt
            }
          });

          if (!exists) {
            await mainPrisma.walletTransaction.create({
              data: {
                points: tx.points,
                description: tx.description || "Migrated from local wallet",
                tenantId: tenant.id,
                walletId: globalWallet.id,
                createdAt: tx.createdAt
              }
            });
          }
        }
      }
    }

    console.log("\n✅ Wallet and customer data migration completed successfully.");
  } catch (err) {
    console.error("Migration failed:", err);
  } finally {
    await mainPrisma.$disconnect();
  }
}

migrate();
