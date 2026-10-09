const ApiError = require("../../../utils/ApiError");

const DEFAULT_FEATURES = ["servi_app", "qr_table", "qr_cashier", "pos"];

const getAll = async (db) => {
  const coupons = await db.coupon.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });

  try {
    const extraRows = await db.$queryRawUnsafe('SELECT "id", "targetTier", "maxCustomerCount", "customerCount", "specificCustomers", "applicableFeatures" FROM "Coupon"');
    const extraMap = new Map(extraRows.map(r => [r.id, r]));
    coupons.forEach(c => {
      const extra = extraMap.get(c.id);
      if (extra) {
        c.targetTier = extra.targetTier || "all";
        c.maxCustomerCount = extra.maxCustomerCount !== undefined ? extra.maxCustomerCount : null;
        c.customerCount = extra.customerCount || 0;
        c.specificCustomers = Array.isArray(extra.specificCustomers) ? extra.specificCustomers : [];
        c.applicableFeatures = Array.isArray(extra.applicableFeatures) ? extra.applicableFeatures : DEFAULT_FEATURES;
      } else {
        c.targetTier = c.targetTier || "all";
        c.maxCustomerCount = c.maxCustomerCount !== undefined ? c.maxCustomerCount : null;
        c.customerCount = c.customerCount || 0;
        c.specificCustomers = Array.isArray(c.specificCustomers) ? c.specificCustomers : [];
        c.applicableFeatures = Array.isArray(c.applicableFeatures) ? c.applicableFeatures : DEFAULT_FEATURES;
      }
    });
  } catch (e) {
    coupons.forEach(c => {
      c.targetTier = c.targetTier || "all";
      c.maxCustomerCount = c.maxCustomerCount !== undefined ? c.maxCustomerCount : null;
      c.customerCount = c.customerCount || 0;
      c.specificCustomers = Array.isArray(c.specificCustomers) ? c.specificCustomers : [];
      c.applicableFeatures = Array.isArray(c.applicableFeatures) ? c.applicableFeatures : DEFAULT_FEATURES;
    });
  }

  return coupons;
};

const create = async (db, data) => {
  const existing = await db.coupon.findUnique({ where: { code: data.code } });
  if (existing) throw new ApiError(400, "Coupon code already exists");

  const targetTier = data.targetTier || "all";
  const maxCustomerCount = data.maxCustomerCount !== undefined && data.maxCustomerCount !== null && data.maxCustomerCount !== "" ? parseInt(data.maxCustomerCount) : null;
  const customerCount = data.customerCount !== undefined ? parseInt(data.customerCount) : 0;
  const specificCustomers = Array.isArray(data.specificCustomers) ? data.specificCustomers : [];
  const applicableFeatures = Array.isArray(data.applicableFeatures) ? data.applicableFeatures : DEFAULT_FEATURES;

  const created = await db.coupon.create({
    data: {
      title: data.title,
      titleAr: data.titleAr || null,
      code: data.code,
      quantity: data.quantity !== undefined ? Number(data.quantity) : 0,
      usedCount: 0,
      locations: data.locations || [],
      type: data.type,
      itemsDeductionType: data.type === "items" ? data.itemsDeductionType || "fixed" : null,
      itemsList: data.type === "items" ? data.itemsList || [] : null,
      discountType: data.type === "orders" ? data.discountType || "percentage" : null,
      discountValue: data.type === "orders" ? (data.discountValue !== undefined ? Number(data.discountValue) : 0) : null,
      priceCap: data.type === "orders" ? (data.priceCap !== undefined && data.priceCap !== "" && data.priceCap !== null ? Number(data.priceCap) : null) : null,
      minOrderAmount: data.type === "orders" ? (data.minOrderAmount !== undefined && data.minOrderAmount !== "" && data.minOrderAmount !== null ? Number(data.minOrderAmount) : 0) : 0,
      startDate: new Date(data.startDate),
      endDate: new Date(data.endDate),
      termsAr: data.termsAr || null,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
    }
  });

  try {
    await db.$executeRawUnsafe(
      'UPDATE "Coupon" SET "targetTier" = $1, "maxCustomerCount" = $2, "customerCount" = $3, "specificCustomers" = $4::jsonb, "applicableFeatures" = $5::jsonb WHERE "id" = $6',
      targetTier,
      maxCustomerCount,
      customerCount,
      JSON.stringify(specificCustomers),
      JSON.stringify(applicableFeatures),
      created.id
    );
  } catch (e) {
    try {
      await db.$executeRawUnsafe('ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "applicableFeatures" JSONB');
      await db.$executeRawUnsafe(
        'UPDATE "Coupon" SET "targetTier" = $1, "maxCustomerCount" = $2, "customerCount" = $3, "specificCustomers" = $4::jsonb, "applicableFeatures" = $5::jsonb WHERE "id" = $6',
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
  const coupon = await db.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(404, "Coupon not found");

  if (data.code !== undefined && data.code !== coupon.code) {
    const existing = await db.coupon.findUnique({ where: { code: data.code } });
    if (existing) throw new ApiError(400, "Coupon code already exists");
  }

  const targetTier = data.targetTier !== undefined ? (data.targetTier || "all") : (coupon.targetTier || "all");
  const maxCustomerCount = data.maxCustomerCount !== undefined ? (data.maxCustomerCount === "" || data.maxCustomerCount === null ? null : parseInt(data.maxCustomerCount)) : (coupon.maxCustomerCount ?? null);
  const customerCount = data.customerCount !== undefined ? parseInt(data.customerCount) : (coupon.customerCount || 0);
  const specificCustomers = data.specificCustomers !== undefined ? (Array.isArray(data.specificCustomers) ? data.specificCustomers : []) : (Array.isArray(coupon.specificCustomers) ? coupon.specificCustomers : []);
  const applicableFeatures = data.applicableFeatures !== undefined 
    ? (Array.isArray(data.applicableFeatures) ? data.applicableFeatures : DEFAULT_FEATURES)
    : (Array.isArray(coupon.applicableFeatures) ? coupon.applicableFeatures : DEFAULT_FEATURES);

  const updated = await db.coupon.update({
    where: { id },
    data: {
      title: data.title !== undefined ? data.title : coupon.title,
      titleAr: data.titleAr !== undefined ? data.titleAr : coupon.titleAr,
      code: data.code !== undefined ? data.code : coupon.code,
      quantity: data.quantity !== undefined ? Number(data.quantity) : coupon.quantity,
      locations: data.locations !== undefined ? data.locations : coupon.locations,
      type: data.type !== undefined ? data.type : coupon.type,
      itemsDeductionType: data.type === "items" ? (data.itemsDeductionType !== undefined ? data.itemsDeductionType : coupon.itemsDeductionType) : null,
      itemsList: data.type === "items" ? (data.itemsList !== undefined ? data.itemsList : coupon.itemsList) : null,
      discountType: data.type === "orders" ? (data.discountType !== undefined ? data.discountType : coupon.discountType) : null,
      discountValue: data.type === "orders" ? (data.discountValue !== undefined ? Number(data.discountValue) : coupon.discountValue) : null,
      priceCap: data.type === "orders" ? (data.priceCap !== undefined ? (data.priceCap === "" || data.priceCap === null ? null : Number(data.priceCap)) : coupon.priceCap) : null,
      minOrderAmount: data.type === "orders" ? (data.minOrderAmount !== undefined ? (data.minOrderAmount === "" || data.minOrderAmount === null ? 0 : Number(data.minOrderAmount)) : coupon.minOrderAmount) : 0,
      startDate: data.startDate !== undefined ? new Date(data.startDate) : coupon.startDate,
      endDate: data.endDate !== undefined ? new Date(data.endDate) : coupon.endDate,
      termsAr: data.termsAr !== undefined ? data.termsAr : coupon.termsAr,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : coupon.isActive,
    }
  });

  try {
    await db.$executeRawUnsafe(
      'UPDATE "Coupon" SET "targetTier" = $1, "maxCustomerCount" = $2, "customerCount" = $3, "specificCustomers" = $4::jsonb, "applicableFeatures" = $5::jsonb WHERE "id" = $6',
      targetTier,
      maxCustomerCount,
      customerCount,
      JSON.stringify(specificCustomers),
      JSON.stringify(applicableFeatures),
      id
    );
  } catch (e) {
    try {
      await db.$executeRawUnsafe('ALTER TABLE "Coupon" ADD COLUMN IF NOT EXISTS "applicableFeatures" JSONB');
      await db.$executeRawUnsafe(
        'UPDATE "Coupon" SET "targetTier" = $1, "maxCustomerCount" = $2, "customerCount" = $3, "specificCustomers" = $4::jsonb, "applicableFeatures" = $5::jsonb WHERE "id" = $6',
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
  const coupon = await db.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(404, "Coupon not found");

  return db.coupon.delete({ where: { id } });
};

module.exports = {
  getAll,
  create,
  update,
  remove
};
