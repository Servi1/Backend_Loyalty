const mainPrisma = require("../src/config/prisma");

async function syncWalletPoints() {
  console.log("🔧 Synchronizing wallet balances with transaction ledger...");

  const wallets = await mainPrisma.wallet.findMany({
    include: { transactions: true }
  });

  for (const w of wallets) {
    const sumPoints = w.transactions.reduce((sum, t) => sum + t.points, 0);
    const sumLifetime = w.transactions.reduce((sum, t) => sum + (t.points > 0 ? t.points : 0), 0);

    await mainPrisma.wallet.update({
      where: { id: w.id },
      data: {
        points: sumPoints,
        lifetimeEarn: sumLifetime
      }
    });

    console.log(`  ✅ Wallet ${w.id} updated: points = ${sumPoints}, lifetimeEarn = ${sumLifetime}`);
  }

  console.log("\n✨ All wallet balances synchronized with transaction history!");
}

syncWalletPoints()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Sync failed:", err);
    process.exit(1);
  });
