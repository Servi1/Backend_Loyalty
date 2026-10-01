const mainPrisma = require("../../../config/prisma");
const ApiError = require("../../../utils/ApiError");
const { getTenantClient } = require("../../../config/tenantManager");

const defaultOrderTypes = [
  { name: "Dine In", nameAr: "محلي / صالة", description: "Enjoy your meal served directly at your table inside our restaurant.", descriptionAr: "تناول وجبتك مباشرة على طاولتك داخل المطعم." },
  { name: "Takeaway", nameAr: "سفري / استلام", description: "Pick up your order directly from the counter when ready.", descriptionAr: "استلم طلبك مباشرة من الكاونتر عند جاهزيته." },
  { name: "Delivery", nameAr: "توصيل", description: "Your order is cooked fresh and delivered to your doorstep.", descriptionAr: "يتم تحضير طلبك وتوصيله مباشرة إلى باب منزلك." },
  { name: "Deliver to Car", nameAr: "توصيل للسيارة", description: "Curbside service — we bring your food right to your parked vehicle.", descriptionAr: "خدمة التوصيل للسيارة — نصلك بطلبك إلى سيارتك." },
  { name: "Scheduled", nameAr: "موعد مسبق", description: "Book an appointment for a specific date and time slot with our specialists.", descriptionAr: "حجز موعد محدد مسبقاً مع المختصين." },
  { name: "Home Service", nameAr: "خدمة منزلية", description: "Our specialist visits your home or office at your scheduled appointment time.", descriptionAr: "زيارة منزلية أو مكتبية في الوقت المحدد." }
];

const seedDefaultOrderTypesIfEmpty = async () => {
  const count = await mainPrisma.globalOrderType.count();
  if (count === 0) {
    console.log("Seeding default global order types...");
    for (const item of defaultOrderTypes) {
      await mainPrisma.globalOrderType.create({
        data: {
          name: item.name,
          nameAr: item.nameAr,
          description: item.description,
          descriptionAr: item.descriptionAr,
          isActive: true
        }
      });
    }
  } else {
    // Backfill descriptions and Arabic names for existing default order types
    for (const item of defaultOrderTypes) {
      const existing = await mainPrisma.globalOrderType.findFirst({
        where: { name: { equals: item.name, mode: "insensitive" } }
      });
      if (existing && (!existing.nameAr || !existing.description || !existing.descriptionAr)) {
        await mainPrisma.globalOrderType.update({
          where: { id: existing.id },
          data: {
            nameAr: existing.nameAr || item.nameAr,
            description: existing.description || item.description,
            descriptionAr: existing.descriptionAr || item.descriptionAr
          }
        });
      }
    }
  }
};

const getAll = async () => {
  await seedDefaultOrderTypesIfEmpty();
  return mainPrisma.globalOrderType.findMany({
    orderBy: { createdAt: "asc" }
  });
};

const create = async (data) => {
  if (!data.name) {
    throw new ApiError(400, "Order Type name is required");
  }
  const existing = await mainPrisma.globalOrderType.findUnique({
    where: { name: data.name }
  });
  if (existing) {
    throw new ApiError(400, "Order Type name already exists");
  }
  const created = await mainPrisma.globalOrderType.create({
    data: {
      name: data.name,
      nameAr: data.nameAr || null,
      description: data.description || null,
      descriptionAr: data.descriptionAr || null,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : true
    }
  });

  // Propagate to all active tenants immediately
  const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });
  for (const tenant of tenants) {
    try {
      const tenantDb = getTenantClient(tenant.dbUrl);
      const localExists = await tenantDb.customOrderType.findFirst({
        where: { name: { equals: created.name, mode: "insensitive" } }
      });
      if (!localExists) {
        await tenantDb.customOrderType.create({
          data: {
            name: created.name,
            nameAr: created.nameAr,
            description: created.description,
            descriptionAr: created.descriptionAr,
            isActive: created.isActive
          }
        });
      } else {
        await tenantDb.customOrderType.update({
          where: { id: localExists.id },
          data: {
            nameAr: created.nameAr || localExists.nameAr,
            description: created.description,
            descriptionAr: created.descriptionAr || localExists.descriptionAr
          }
        });
      }
    } catch (err) {
      console.error(`Failed to propagate new global order type ${created.name} to tenant ${tenant.name}:`, err.message);
    }
  }

  return created;
};

const update = async (id, data) => {
  const existing = await mainPrisma.globalOrderType.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(404, "Order Type not found");
  }
  
  if (data.name) {
    const nameCheck = await mainPrisma.globalOrderType.findUnique({
      where: { name: data.name }
    });
    if (nameCheck && nameCheck.id !== id) {
      throw new ApiError(400, "Order Type name already exists");
    }
  }

  const updated = await mainPrisma.globalOrderType.update({
    where: { id },
    data: {
      name: data.name !== undefined ? data.name : existing.name,
      nameAr: data.nameAr !== undefined ? data.nameAr : existing.nameAr,
      description: data.description !== undefined ? data.description : existing.description,
      descriptionAr: data.descriptionAr !== undefined ? data.descriptionAr : existing.descriptionAr,
      isActive: data.isActive !== undefined ? Boolean(data.isActive) : existing.isActive
    }
  });

  // Propagate update to all active tenants immediately
  const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });
  for (const tenant of tenants) {
    try {
      const tenantDb = getTenantClient(tenant.dbUrl);
      await tenantDb.customOrderType.updateMany({
        where: { name: existing.name },
        data: {
          name: updated.name,
          nameAr: updated.nameAr,
          description: updated.description,
          descriptionAr: updated.descriptionAr,
          ...(data.isActive === false && { isActive: false })
        }
      });
    } catch (err) {
      console.error(`Failed to propagate update of global order type ${existing.name} to tenant ${tenant.name}:`, err.message);
    }
  }

  return updated;
};

const remove = async (id) => {
  const existing = await mainPrisma.globalOrderType.findUnique({ where: { id } });
  if (!existing) {
    throw new ApiError(404, "Order Type not found");
  }
  
  // Propagate deletion to all active tenants immediately
  const tenants = await mainPrisma.tenant.findMany({ where: { isActive: true } });
  for (const tenant of tenants) {
    try {
      const tenantDb = getTenantClient(tenant.dbUrl);
      await tenantDb.customOrderType.deleteMany({
        where: { name: existing.name }
      });
    } catch (err) {
      console.error(`Failed to propagate deletion of global order type ${existing.name} to tenant ${tenant.name}:`, err.message);
    }
  }

  await mainPrisma.globalOrderType.delete({ where: { id } });
  return { success: true };
};

module.exports = {
  getAll,
  create,
  update,
  remove
};
