import { PrismaClient } from "@prisma/client";
import { hash } from "bcryptjs";

const prisma = new PrismaClient();

async function main() {
  console.log("🌱 Seeding database...");

  // 1. Seed CurrencySettings singleton
  await prisma.currencySettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      manualInrRate: 85.0,
      markupPercent: 5.0,
      autoUpdateEnabled: false,
      autoUpdateFreq: "hourly",
    },
    update: {},
  });
  console.log("✅ CurrencySettings seeded");

  // 2. Seed SiteSettings singleton
  await prisma.siteSettings.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      siteName: "NexusSMM",
      maintenanceMode: false,
    },
    update: {},
  });
  console.log("✅ SiteSettings seeded");

  // 3. Seed admin user (only in development)
  if (process.env["NODE_ENV"] !== "production") {
    const adminEmail = "admin@nexussmm.com";
    const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

    if (!existing) {
      const passwordHash = await hash("Admin@123456", 12);
      await prisma.user.create({
        data: {
          email: adminEmail,
          displayName: "Admin",
          passwordHash,
          emailVerified: true,
          isAdmin: true,
        },
      });
      console.log(`✅ Admin user created: ${adminEmail} / Admin@123456`);
    } else {
      console.log(`ℹ️  Admin user already exists: ${adminEmail}`);
    }
  }

  // 4. Seed default categories
  const defaultCategories = [
    { name: "Telegram Members", displayOrder: 1 },
    { name: "Telegram Views", displayOrder: 2 },
    { name: "Telegram Reactions", displayOrder: 3 },
    { name: "Telegram Boost", displayOrder: 4 },
    { name: "Instagram Followers", displayOrder: 5 },
    { name: "Instagram Likes", displayOrder: 6 },
    { name: "YouTube Views", displayOrder: 7 },
    { name: "YouTube Subscribers", displayOrder: 8 },
    { name: "Facebook", displayOrder: 9 },
    { name: "Other", displayOrder: 10 },
  ];

  for (const cat of defaultCategories) {
    await prisma.category.upsert({
      where: { id: `seed-cat-${cat.displayOrder}` },
      create: { id: `seed-cat-${cat.displayOrder}`, ...cat },
      update: { name: cat.name, displayOrder: cat.displayOrder },
    });
  }
  console.log("✅ Default categories seeded");

  console.log("✅ Database seeding complete");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
