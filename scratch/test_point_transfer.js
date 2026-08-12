const mainPrisma = require("../src/config/prisma");
const walletService = require("../src/app/wallet/wallet.service");

async function testPointTransfer() {
  console.log("🎁 Testing Loyalty Point Transfer / Gift system...");

  // 1. Get sender customer (Faisal Test Customer)
  const sender = await mainPrisma.appUser.findFirst({
    where: { phone: "966555123456" },
    include: { wallet: true }
  });

  if (!sender || !sender.wallet) {
    console.error("❌ Sender wallet not found!");
    process.exit(1);
  }

  // 2. Find or create a recipient customer
  let recipientPhone = "+966500999888";
  let recipient = await mainPrisma.appUser.findFirst({
    where: { phone: recipientPhone },
    include: { wallet: true }
  });

  if (!recipient) {
    recipient = await mainPrisma.appUser.create({
      data: {
        phone: recipientPhone,
        name: "Receiver Friend",
        email: "receiver.friend@test.com"
      }
    });
  }

  if (!recipient.wallet) {
    await mainPrisma.wallet.create({
      data: { appUserId: recipient.id, points: 0, lifetimeEarn: 0 }
    });
  }

  console.log(`👤 Sender: ${sender.name} (${sender.phone}) | Current Points: ${sender.wallet.points}`);
  console.log(`👤 Recipient: ${recipient.name} (${recipient.phone})`);

  // 3. Perform a 25 points transfer gift
  const pointsToTransfer = 25;
  console.log(`\n💸 Transferring ${pointsToTransfer} points from ${sender.name} to ${recipient.name}...`);

  await walletService.transferPoints(null, null, sender.id, {
    recipientPhone,
    points: pointsToTransfer,
    message: "Enjoy your free meal gift!"
  });

  // 4. Claim the gift by recipient
  const gifts = await walletService.getGifts(null, recipient.id);
  console.log(`🎁 Unclaimed gifts for ${recipient.name}:`, gifts);

  if (gifts.length > 0) {
    console.log(`\n🎉 Recipient claiming gift ID: ${gifts[0].id}...`);
    await walletService.claimGift(null, null, recipient.id, gifts[0].id);
  }

  // 5. Verify wallet transactions for both sender and recipient
  const senderTxs = await mainPrisma.walletTransaction.findMany({
    where: { walletId: sender.wallet.id },
    orderBy: { createdAt: "desc" },
    take: 5
  });

  const recipientWallet = await mainPrisma.wallet.findUnique({ where: { appUserId: recipient.id } });
  const recipientTxs = await mainPrisma.walletTransaction.findMany({
    where: { walletId: recipientWallet.id },
    orderBy: { createdAt: "desc" },
    take: 5
  });

  console.log("\n=================================================");
  console.log("📋 SENDER WALLET TRANSACTIONS:");
  console.table(senderTxs.map(t => ({ id: t.id, points: t.points, description: t.description })));

  console.log("\n📋 RECIPIENT WALLET TRANSACTIONS:");
  console.table(recipientTxs.map(t => ({ id: t.id, points: t.points, description: t.description })));

  console.log("\n✨ Point Transfer & Claim completed successfully!");
}

testPointTransfer()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ Test failed:", err);
    process.exit(1);
  });
