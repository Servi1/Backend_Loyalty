const { PrismaClient } = require("@prisma/client-main");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();

async function main() {
  const email = "admin@servio.com";
  const password = "password123";
  const hashedPassword = await bcrypt.hash(password, 10);

  const existingAdmin = await prisma.superAdmin.findUnique({ where: { email } });

  if (!existingAdmin) {
    await prisma.superAdmin.create({
      data: {
        email,
        password: hashedPassword,
        name: "Servio Super Admin",
      },
    });
    console.log(`✅ Super Admin created: ${email} / ${password}`);
  } else {
    console.log(`ℹ️ Super Admin already exists: ${email}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
