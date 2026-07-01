const ApiError = require("../../../utils/ApiError");

const getAll = async (db) => {
  return db.discount.findMany({
    orderBy: {
      createdAt: "desc"
    }
  });
};

const create = async (db, data) => {
  return db.discount.create({
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
    }
  });
};

const update = async (db, id, data) => {
  const discount = await db.discount.findUnique({ where: { id } });
  if (!discount) throw new ApiError(404, "Discount not found");

  return db.discount.update({
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
    }
  });
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
