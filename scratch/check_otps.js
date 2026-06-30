const mainPrisma = require("../src/config/prisma");

async function checkOtps() {
  try {
    const otps = await mainPrisma.otp.findMany({
      orderBy: { createdAt: "desc" },
      take: 10,
    });
    console.log("Recent OTPs in DB:", otps);
  } catch (err) {
    console.error("Error fetching OTPs:", err);
  } finally {
    await mainPrisma.$disconnect();
    process.exit(0);
  }
}

checkOtps();
