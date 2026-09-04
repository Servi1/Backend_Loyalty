const mainPrisma = require("../../../config/prisma");

const defaults = {
  marketEnabled: "true",
  maintenance_mode: "false",
  new_signups: "true",
  guest_checkout: "true",
  scheduled_orders: "false",
  auto_payout: "true",
  refund_enabled: "true",
  push_notifications: "true",
  email_marketing: "false",
  disabledCategories: "",
  platform_vat: "15.0"
};

const DEFAULT_PRIVACY_POLICY = `Privacy Policy
Last updated: September 2026

At Servi, we are committed to protecting your privacy and ensuring your personal information is handled in a safe and responsible manner.

1. Information We Collect
We collect information you provide directly to us when using our application, such as your name, phone number, email address, address details, and order history.

2. How We Use Your Information
We use the information we collect to provide, maintain, and improve our services, process transactions, deliver food & services to your table/location, and communicate loyalty rewards with you.

3. Loyalty & Rewards Program
Your orders accumulate points based on established brand tier rules. Points earned or redeemed are logged securely to your account wallet.

4. Information Sharing
We do not sell or share your personal information with third parties except as necessary to fulfill your orders (such as passing your contact details to brand store staff) or as required by law.

5. Data Security
We implement appropriate technical and organizational security measures to protect your personal data against unauthorized access, alteration, or disclosure.

6. Contact Us
If you have any questions or concerns about this Privacy Policy, please contact our support team at support@servi.com.`;

const DEFAULT_FAQ_LIST = [
  {
    id: "faq_1",
    question: "How do I earn loyalty points on my orders?",
    answer: "You automatically earn points on every completed order paid via cash, card, or digital payment methods according to your brand's earn rate and daily tier limit."
  },
  {
    id: "faq_2",
    question: "How can I redeem my accumulated loyalty points?",
    answer: "During checkout on mobile ordering or QR Table/Cashier ordering, choose 'Pay with Loyalty Points' if you have sufficient points balance in your wallet."
  },
  {
    id: "faq_3",
    question: "How do tier levels work (Starter, Bronze, Silver, Gold, Platinum)?",
    answer: "Tier levels are automatically assigned based on your total completed orders and cumulative spend value. Higher tiers unlock higher daily point caps and exclusive benefits."
  },
  {
    id: "faq_4",
    question: "What happens if an order is cancelled or refunded?",
    answer: "If an order is cancelled or refunded, any loyalty points awarded for that order will be automatically reversed from your wallet."
  }
];

const getSettings = async () => {
  const settings = await mainPrisma.systemSetting.findMany();
  const settingsMap = {};
  for (const s of settings) {
    settingsMap[s.key] = s.value;
  }

  const result = [];
  for (const [key, defaultValue] of Object.entries(defaults)) {
    let value = settingsMap[key];
    if (value === undefined) {
      try {
        const created = await mainPrisma.systemSetting.create({
          data: { key, value: defaultValue }
        });
        value = created.value;
      } catch (err) {
        const found = await mainPrisma.systemSetting.findUnique({ where: { key } });
        value = found ? found.value : defaultValue;
      }
    }
    result.push({ key, value });
  }
  return result;
};

const updateSettings = async (configs) => {
  const updated = [];
  for (const item of configs) {
    const { key, value } = item;
    const stringValue = String(value);
    const record = await mainPrisma.systemSetting.upsert({
      where: { key },
      update: { value: stringValue },
      create: { key, value: stringValue }
    });
    updated.push(record);
  }
  return updated;
};

const getAppContent = async () => {
  const [privacyRecord, faqRecord] = await Promise.all([
    mainPrisma.systemSetting.findUnique({ where: { key: "privacy_policy" } }),
    mainPrisma.systemSetting.findUnique({ where: { key: "faq_list" } })
  ]);

  let privacyPolicy = privacyRecord ? privacyRecord.value : DEFAULT_PRIVACY_POLICY;
  let faqList = DEFAULT_FAQ_LIST;

  if (faqRecord && faqRecord.value) {
    try {
      faqList = JSON.parse(faqRecord.value);
    } catch (e) {
      faqList = DEFAULT_FAQ_LIST;
    }
  }

  return {
    privacyPolicy,
    faqList
  };
};

const updateAppContent = async ({ privacyPolicy, faqList }) => {
  const updates = [];

  if (privacyPolicy !== undefined) {
    updates.push(
      mainPrisma.systemSetting.upsert({
        where: { key: "privacy_policy" },
        update: { value: String(privacyPolicy) },
        create: { key: "privacy_policy", value: String(privacyPolicy) }
      })
    );
  }

  if (faqList !== undefined) {
    const faqString = typeof faqList === "string" ? faqList : JSON.stringify(faqList);
    updates.push(
      mainPrisma.systemSetting.upsert({
        where: { key: "faq_list" },
        update: { value: faqString },
        create: { key: "faq_list", value: faqString }
      })
    );
  }

  await Promise.all(updates);
  return getAppContent();
};

module.exports = {
  getSettings,
  updateSettings,
  getAppContent,
  updateAppContent
};
