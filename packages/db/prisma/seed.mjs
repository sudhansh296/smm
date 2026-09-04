// Plain ESM seed — no TypeScript, no path aliases
// Run: node prisma/seed.mjs

import { PrismaClient } from "@prisma/client";
import { createHash } from "crypto";

// Simple bcrypt work-around for seeding — use a known hash for dev password
// Password: Admin@123456
// Pre-computed bcrypt hash (rounds=12)
const ADMIN_PASSWORD_HASH =
  "$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TiGwa5Nn3Z8VXQDEpF3PQRlQFCai";

const prisma = new PrismaClient({
  datasources: { db: { url: process.env.DATABASE_URL } },
});

async function main() {
  console.log("🌱 Seeding database...");

  // CurrencySettings singleton
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
  console.log("✅ CurrencySettings seeded (₹85/$1 + 5% markup)");

  // SiteSettings singleton
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

  // Admin user
  const adminEmail = "admin@nexussmm.com";
  const existing = await prisma.user.findUnique({ where: { email: adminEmail } });

  if (!existing) {
    await prisma.user.create({
      data: {
        email: adminEmail,
        displayName: "Admin",
        passwordHash: ADMIN_PASSWORD_HASH,
        emailVerified: true,
        isAdmin: true,
      },
    });
    console.log(`✅ Admin user created: ${adminEmail} / Admin@123456`);
  } else {
    console.log(`ℹ️  Admin user already exists: ${adminEmail}`);
  }

  // Default categories
  const cats = [
    { id: "cat-tg-members", name: "Telegram Members", displayOrder: 1 },
    { id: "cat-tg-views", name: "Telegram Views", displayOrder: 2 },
    { id: "cat-tg-reactions", name: "Telegram Reactions", displayOrder: 3 },
    { id: "cat-tg-boost", name: "Telegram Boost", displayOrder: 4 },
    { id: "cat-ig-followers", name: "Instagram Followers", displayOrder: 5 },
    { id: "cat-ig-likes", name: "Instagram Likes", displayOrder: 6 },
    { id: "cat-yt-views", name: "YouTube Views", displayOrder: 7 },
    { id: "cat-yt-subs", name: "YouTube Subscribers", displayOrder: 8 },
    { id: "cat-facebook", name: "Facebook", displayOrder: 9 },
    { id: "cat-other", name: "Other", displayOrder: 10 },
  ];

  for (const cat of cats) {
    await prisma.category.upsert({
      where: { id: cat.id },
      create: cat,
      update: { name: cat.name, displayOrder: cat.displayOrder },
    });
  }
  console.log("✅ Default categories seeded");

  console.log("\n✅ Database seeding complete!");
  console.log("\nAdmin login:");
  console.log("  Email:    admin@nexussmm.com");
  console.log("  Password: Admin@123456");
}

main()
  .catch((e) => { console.error("❌ Seed failed:", e); process.exit(1); })
  .finally(() => prisma.$disconnect());
