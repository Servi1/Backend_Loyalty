const mainPrisma = require("../src/config/prisma");

async function verifyPointsMath() {
  console.log("🔍 Auditing Loyalty Points Math & Wallet Ledger Consistency...\n");

  const faisal = await mainPrisma.appUser.findFirst({
    where: {
      OR: [
        { phone: "+966555123456" },
        { phone: "966555123456" },
        { name: { contains: "Faisal" } }
      ]
    },
    include: { wallet: true }
  });

  if (!faisal || !faisal.wallet) {
    console.error("❌ Customer Faisal or Wallet not found!");
    process.exit(1);
  }

  const txs = await mainPrisma.walletTransaction.findMany({
    where: { walletId: faisal.wallet.id },
    orderBy: { createdAt: "asc" }
  });

  let computedPoints = 0;
  let computedLifetime = 0;

  const auditLedger = txs.map(t => {
    computedPoints += t.points;
    if (t.points > 0) computedLifetime += t.points;

    return {
      date: t.createdAt.toISOString().split("T")[0],
      txPoints: t.points > 0 ? `+${t.points}` : `${t.points}`,
      runningBalance: computedPoints,
      description: t.description
    };
  });

  console.log(`👤 Customer: ${faisal.name} (${faisal.phone})`);
  console.log(`💳 Current Wallet Balance in DB: ${faisal.wallet.points} pts`);
  console.log(`📊 Sum of Wallet Transactions: ${computedPoints} pts`);
  console.log(`⭐ Lifetime Earned Points in DB: ${faisal.wallet.lifetimeEarn} pts`);
  console.log(`⭐ Sum of Positive Earned/Received Transactions: ${computedLifetime} pts\n`);

  console.table(auditLedger);

  const isPointsMatched = computedPoints === faisal.wallet.points;
  const isLifetimeMatched = computedLifetime === faisal.wallet.lifetimeEarn;

  console.log("\n========================================================");
  if (isPointsMatched && isLifetimeMatched) {
    console.log("✅ AUDIT PASSED: Loyalty Points Math is 100% PERFECT & IN SYNC!");
  } else {
    console.error("❌ AUDIT MISMATCH: Discrepancy detected in wallet ledger!");
  }
  console.log("========================================================");
}

verifyPointsMath()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Audit script failed:", err);
    process.exit(1);
  });
