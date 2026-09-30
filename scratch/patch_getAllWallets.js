const fs = require('fs');
const path = require('path');

const filePath = path.resolve(__dirname, '../src/app/wallet/wallet.service.js');
let content = fs.readFileSync(filePath, 'utf8');

// Normalize to LF for matching
const norm = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

const startMarker = '// ─── getAllWallets ─────────────────────────────────────────────────────────────';
const endMarker = '// ─── getTransactions ──────────────────────────────────────────────────────────';

const startIdx = norm.indexOf(startMarker);
const endIdx = norm.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1) {
  console.error('ERROR: Could not find markers in file!');
  console.log('startIdx:', startIdx, 'endIdx:', endIdx);
  process.exit(1);
}

const newBlock = `// ─── getAllWallets ─────────────────────────────────────────────────────────────

const getAllWallets = async (db, userId) => {
  await processExpiredGifts();
  const allWallets = await mainPrisma.wallet.findMany({
    where: { appUserId: userId, tenantId: { not: null } },
    include: {
      tenant: {
        select: {
          id: true,
          name: true,
          slug: true,
          logoUrl: true,
          stampPrograms: true,
        },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const globalPoints = allWallets.reduce((sum, w) => sum + (w.points || 0), 0);

  // ── Fetch active (unused, non-expired) coupons for this user across all tenants ──
  const activeCoupons = await mainPrisma.earnedCoupon.findMany({
    where: {
      appUserId: userId,
      isUsed: false,
      expiresAt: { gt: new Date() },
    },
    orderBy: { createdAt: "desc" },
  });

  // ── Fetch the AppUser so we can embed phone in the stamp QR payload ──
  const appUser = await mainPrisma.appUser.findUnique({
    where: { id: userId },
    select: { id: true, phone: true, name: true },
  });

  const walletsData = allWallets.map(w => {
    const stampProg = Array.isArray(w.tenant?.stampPrograms) && w.tenant.stampPrograms.length > 0 ? w.tenant.stampPrograms[0] : null;
    const requiredStamps = Number(stampProg?.requiredStamps || 6);
    const currentStamps = w.stamps || 0;
    const isComplete = stampProg ? (currentStamps >= requiredStamps) : false;

    // Find the most-recent active coupon for this brand wallet
    const coupon = activeCoupons.find(c => c.tenantId === w.tenantId) || null;

    // Build the customer STAMP QR payload — scanned by POS/cashier to award stamps
    const stampQrPayload = JSON.stringify({
      customerId: appUser?.id || userId,
      phone: appUser?.phone || null,
      tenantId: w.tenantId,
      type: "STAMP",
    });

    return {
      walletId: w.id,
      tenantId: w.tenantId,
      brandName: w.tenant?.name || "Brand Wallet",
      brandSlug: w.tenant?.slug || null,
      logoUrl: w.tenant?.logoUrl || null,
      points: w.points || 0,
      lifetimeEarn: w.lifetimeEarn || 0,
      stamps: currentStamps,
      tier: w.tier || "bronze",
      stampProgram: stampProg,
      stampProgress: stampProg ? {
        currentStamps,
        requiredStamps,
        remainingForReward: Math.max(0, requiredStamps - currentStamps),
        isComplete,
        rewardTextEn: stampProg.rewardTextEn || "Free Stamp Reward",
        rewardTextAr: stampProg.rewardTextAr || null,
        cardBgColor: stampProg.cardBgColor || "#7F1D1D",
        cardTextColor: stampProg.cardTextColor || "#FFFFFF",
        enabled: stampProg.enabled !== false,
      } : null,
      stampQrPayload,  // QR the customer shows to the cashier to earn stamps
      activeCoupon: coupon ? {
        id: coupon.id,
        code: coupon.code,
        prizeLabel: coupon.prizeLabel,
        prizeImageUrl: coupon.prizeImageUrl || null,
        menuItemId: coupon.menuItemId || null,
        expiresAt: coupon.expiresAt,
        // QR payload for cashier to validate coupon at redemption
        qrPayload: JSON.stringify({
          code: coupon.code,
          tenantId: w.tenantId,
          customerId: userId,
          menuItemId: coupon.menuItemId || null,
          type: "COUPON",
        }),
      } : null,
    };
  });

  return {
    globalPoints,
    wallets: walletsData,
  };
};

`;

const before = norm.slice(0, startIdx);
const after = norm.slice(endIdx);
const newContent = before + newBlock + after;

// Restore CRLF line endings to match original
const finalContent = newContent.replace(/\n/g, '\r\n');
fs.writeFileSync(filePath, finalContent, 'utf8');
console.log('SUCCESS: getAllWallets patched successfully!');
console.log('Lines written:', finalContent.split('\r\n').length);
