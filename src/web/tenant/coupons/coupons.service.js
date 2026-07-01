const ApiError = require("../../../utils/ApiError");

const getAll = async (db) => {
  return db.coupon.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });
};

const create = async (db, data) => {
  // Check if coupon code already exists
  const existing = await db.coupon.findUnique({ where: { code: data.code } });
  if (existing) throw new ApiError(400, "Coupon code already exists");

  return db.coupon.create({
    data: {
      title: data.title,
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
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true,
    }
  });
};

const update = async (db, id, data) => {
  const coupon = await db.coupon.findUnique({ where: { id } });
  if (!coupon) throw new ApiError(404, "Coupon not found");

  if (data.code !== undefined && data.code !== coupon.code) {
    const existing = await db.coupon.findUnique({ where: { code: data.code } });
    if (existing) throw new ApiError(400, "Coupon code already exists");
  }

  return db.coupon.update({
    where: { id },
    data: {
      title: data.title !== undefined ? data.title : coupon.title,
      code: data.code !== undefined ? data.code : coupon.code,
      quantity: data.quantity !== undefined ? Number(data.quantity) : coupon.quantity,
      locations: data.locations !== undefined ? data.locations : coupon.locations,
      type: data.type !== undefined ? data.type : coupon.type,
      itemsDeductionType: data.itemsDeductionType !== undefined ? data.itemsDeductionType : coupon.itemsDeductionType,
      itemsList: data.itemsList !== undefined ? data.itemsList : coupon.itemsList,
      discountType: data.discountType !== undefined ? data.discountType : coupon.discountType,
      discountValue: data.discountValue !== undefined ? Number(data.discountValue) : coupon.discountValue,
      priceCap: data.priceCap !== undefined ? (data.priceCap === "" || data.priceCap === null ? null : Number(data.priceCap)) : coupon.priceCap,
      minOrderAmount: data.minOrderAmount !== undefined ? (data.minOrderAmount === "" || data.minOrderAmount === null ? 0 : Number(data.minOrderAmount)) : coupon.minOrderAmount,
      startDate: data.startDate !== undefined ? new Date(data.startDate) : coupon.startDate,
      endDate: data.endDate !== undefined ? new Date(data.endDate) : coupon.endDate,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : coupon.isActive,
    }
  });
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
