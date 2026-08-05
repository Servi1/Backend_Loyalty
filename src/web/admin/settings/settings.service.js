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
        // If race condition/duplicate key happens, just query it again
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
    // Map value to string
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

module.exports = {
  getSettings,
  updateSettings
};
