const mainPrisma = require("../src/config/prisma");

async function check() {
  const users = await mainPrisma.appUser.findMany();
  console.log(`Total users in database: ${users.length}`);
  users.forEach(u => console.log(`- ID: ${u.id}, Phone: ${u.phone}, Email: ${u.email}, Name: ${u.name}`));
}

check()
  .catch(console.error)
  .finally(() => mainPrisma.$disconnect());
