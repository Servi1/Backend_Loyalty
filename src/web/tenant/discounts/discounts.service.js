const ApiError = require("../../../utils/ApiError");

const DEFAULT_FEATURES = ["servi_app", "qr_table", "qr_cashier", "pos"];

const getAll = async (db) => {
  const discounts = await db.discount.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });

  try {
    const extraRows = await db.$queryRawUnsafe('SELECT "id", "targetTier", "maxCustomerCount", "customerCount", "specificCustomers", "applicableFeatures" FROM "Discount"');
    const extraMap = new Map(extraRows.map(r => [r.id, r]));
    discounts.forEach(d => {
      const extra = extraMap.get(d.id);
      if (extra) {
        d.targetTier = extra.targetTier || "all";
        d.maxCustomerCount = extra.maxCustomerCount !== undefined ? extra.maxCustomerCount : null;
        d.customerCount = extra.customerCount || 0;
        d.specificCustomers = Array.isArray(extra.specificCustomers) ? extra.specificCustomers : [];
        d.applicableFeatures = Array.isArray(extra.applicableFeatures) ? extra.applicableFeatures : DEFAULT_FEATURES;
      } else {
        d.targetTier = d.targetTier || "all";
        d.maxCustomerCount = d.maxCustomerCount !== undefined ? d.maxCustomerCount : null;
        d.customerCount = d.customerCount || 0;
        d.specificCustomers = Array.isArray(d.specificCustomers) ? d.specificCustomers : [];
        d.applicableFeatures = Array.isArray(d.applicableFeatures) ? d.applicableFeatures : DEFAULT_FEATURES;
      }
    });
  } catch (e) {
    discounts.forEach(d => {
      d.targetTier = d.targetTier || "all";
      d.maxCustomerCount = d.maxCustomerCount !== undefined ? d.maxCustomerCount : null;
      d.customerCount = d.customerCount || 0;
      d.specificCustomers = Array.isArray(d.specificCustomers) ? d.specificCustomers : [];
      d.applicableFeatures = Array.isArray(d.applicableFeatures) ? d.applicableFeatures : DEFAULT_FEATURES;
    });
  }

  return discounts;
};

const create = async (db, data) => {
  const targetTier = data.targetTier || "all";
  const maxCustomerCount = data.maxCustomerCount !== undefined && data.maxCustomerCount !== null && data.maxCustomerCount !== "" ? parseInt(data.maxCustomerCount) : null;
  const customerCount = data.customerCount !== undefined ? parseInt(data.customerCount) : 0;
  const specificCustomers = Array.isArray(data.specificCustomers) ? data.specificCustomers : [];
  const applicableFeatures = Array.isArray(data.applicableFeatures) ? data.applicableFeatures : DEFAULT_FEATURES;

  const created = await db.discount.create({
    data: {
      nameEn: data.nameEn,
      nameAr: data.nameAr || null,
      type: data.type,
      value: Number(data.value) || 0,
      maxAmount: data.maxAmount !== undefined && data.maxAmount !== null && data.maxAmount !== "" ? Number(data.maxAmount) : null,
      applyInstantly: data.applyInstantly !== undefined ? Boolean(data.applyInstantly) : true,
      appliedOn: data.appliedOn || "orders",
      locations: data.locations || [],
      hasDateRange: Boolean(data.hasDateRange),
      startDate: data.startDate ? new Date(data.startDate) : null,
      endDate: data.endDate ? new Date(data.endDate) : null,
      hasWeeklySchedule: Boolean(data.hasWeeklySchedule),
      weeklySchedule: data.weeklySchedule || null,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
      itemsList: data.itemsList || null,
    }
  });

  try {
    await db.$executeRawUnsafe(
      'UPDATE "Discount" SET "targetTier" = $1, "maxCustomerCount" = $2, "customerCount" = $3, "specificCustomers" = $4::jsonb, "applicableFeatures" = $5::jsonb WHERE "id" = $6',
      targetTier,
      maxCustomerCount,
      customerCount,
      JSON.stringify(specificCustomers),
      JSON.stringify(applicableFeatures),
      created.id
    );
  } catch (e) {
    try {
      await db.$executeRawUnsafe('ALTER TABLE "Discount" ADD COLUMN IF NOT EXISTS "applicableFeatures" JSONB');
      await db.$executeRawUnsafe(
        'UPDATE "Discount" SET "targetTier" = $1, "maxCustomerCount" = $2, "customerCount" = $3, "specificCustomers" = $4::jsonb, "applicableFeatures" = $5::jsonb WHERE "id" = $6',
        targetTier,
        maxCustomerCount,
        customerCount,
        JSON.stringify(specificCustomers),
        JSON.stringify(applicableFeatures),
        created.id
      );
    } catch (err) {}
  }

  created.targetTier = targetTier;
  created.maxCustomerCount = maxCustomerCount;
  created.customerCount = customerCount;
  created.specificCustomers = specificCustomers;
  created.applicableFeatures = applicableFeatures;

  return created;
};

const update = async (db, id, data) => {
  const discount = await db.discount.findUnique({ where: { id } });
  if (!discount) throw new ApiError(404, "Discount not found");

  const targetTier = data.targetTier !== undefined ? (data.targetTier || "all") : (discount.targetTier || "all");
  const maxCustomerCount = data.maxCustomerCount !== undefined ? (data.maxCustomerCount === "" || data.maxCustomerCount === null ? null : parseInt(data.maxCustomerCount)) : (discount.maxCustomerCount ?? null);
  const customerCount = data.customerCount !== undefined ? parseInt(data.customerCount) : (discount.customerCount || 0);
  const specificCustomers = data.specificCustomers !== undefined ? (Array.isArray(data.specificCustomers) ? data.specificCustomers : []) : (Array.isArray(discount.specificCustomers) ? discount.specificCustomers : []);
  const applicableFeatures = data.applicableFeatures !== undefined 
    ? (Array.isArray(data.applicableFeatures) ? data.applicableFeatures : DEFAULT_FEATURES)
    : (Array.isArray(discount.applicableFeatures) ? discount.applicableFeatures : DEFAULT_FEATURES);

  const updated = await db.discount.update({
    where: { id },
    data: {
      nameEn: data.nameEn !== undefined ? data.nameEn : discount.nameEn,
      nameAr: data.nameAr !== undefined ? data.nameAr : discount.nameAr,
      type: data.type !== undefined ? data.type : discount.type,
      value: data.value !== undefined ? Number(data.value) : discount.value,
      maxAmount: data.maxAmount !== undefined ? (data.maxAmount === "" || data.maxAmount === null ? null : Number(data.maxAmount)) : discount.maxAmount,
      applyInstantly: data.applyInstantly !== undefined ? Boolean(data.applyInstantly) : discount.applyInstantly,
      appliedOn: data.appliedOn !== undefined ? data.appliedOn : discount.appliedOn,
      locations: data.locations !== undefined ? data.locations : discount.locations,
      hasDateRange: data.hasDateRange !== undefined ? Boolean(data.hasDateRange) : discount.hasDateRange,
      startDate: data.startDate !== undefined ? (data.startDate ? new Date(data.startDate) : null) : discount.startDate,
      endDate: data.endDate !== undefined ? (data.endDate ? new Date(data.endDate) : null) : discount.endDate,
      hasWeeklySchedule: data.hasWeeklySchedule !== undefined ? Boolean(data.hasWeeklySchedule) : discount.hasWeeklySchedule,
      weeklySchedule: data.weeklySchedule !== undefined ? data.weeklySchedule : discount.weeklySchedule,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : discount.isActive,
      itemsList: data.itemsList !== undefined ? data.itemsList : discount.itemsList,
    }
  });

  try {
    await db.$executeRawUnsafe(
      'UPDATE "Discount" SET "targetTier" = $1, "maxCustomerCount" = $2, "customerCount" = $3, "specificCustomers" = $4::jsonb, "applicableFeatures" = $5::jsonb WHERE "id" = $6',
      targetTier,
      maxCustomerCount,
      customerCount,
      JSON.stringify(specificCustomers),
      JSON.stringify(applicableFeatures),
      id
    );
  } catch (e) {
    try {
      await db.$executeRawUnsafe('ALTER TABLE "Discount" ADD COLUMN IF NOT EXISTS "applicableFeatures" JSONB');
      await db.$executeRawUnsafe(
        'UPDATE "Discount" SET "targetTier" = $1, "maxCustomerCount" = $2, "customerCount" = $3, "specificCustomers" = $4::jsonb, "applicableFeatures" = $5::jsonb WHERE "id" = $6',
        targetTier,
        maxCustomerCount,
        customerCount,
        JSON.stringify(specificCustomers),
        JSON.stringify(applicableFeatures),
        id
      );
    } catch (err) {}
  }

  updated.targetTier = targetTier;
  updated.maxCustomerCount = maxCustomerCount;
  updated.customerCount = customerCount;
  updated.specificCustomers = specificCustomers;
  updated.applicableFeatures = applicableFeatures;

  return updated;
};

const remove = async (db, id) => {
  const discount = await db.discount.findUnique({ where: { id } });
  if (!discount) throw new ApiError(404, "Discount not found");

  return db.discount.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  update,
  remove
};
