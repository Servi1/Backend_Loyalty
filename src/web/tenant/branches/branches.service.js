const ApiError = require("../../../utils/ApiError");

const getAll = async (db) =>
  db.branch.findMany({
    include: {
      locationGroup: true,
      customPaymentTypes: true,
      customOrderTypes: true,
      _count: { select: { tables: true, orders: true, staff: true } }
    }
  });

const getById = async (db, id) => {
  const branch = await db.branch.findUnique({
    where: { id },
    include: {
      tables: true,
      staff: true,
      locationGroup: true,
      customPaymentTypes: true,
      customOrderTypes: true
    }
  });
  if (!branch) throw new ApiError(404, "Branch not found");
  return branch;
};

const create = async (db, data) => {
  const { customPaymentTypeIds, customOrderTypeIds, ...rest } = data;
  const insertData = { ...rest };
  
  const initSub = (field, subField) => {
    if (insertData[field] === true) {
      insertData[subField] = new Date();
    } else if (insertData[field] === false) {
      insertData[subField] = null;
    }
  };

  initSub("tablesEnabled", "tablesSubscribedAt");
  initSub("posEnabled", "posSubscribedAt");
  initSub("qrEnabled", "qrSubscribedAt");
  initSub("kdsEnabled", "kdsSubscribedAt");
  initSub("cdsEnabled", "cdsSubscribedAt");
  initSub("appServiEnabled", "appServiSubscribedAt");

  const relations = {};
  if (Array.isArray(customPaymentTypeIds)) {
    relations.customPaymentTypes = {
      connect: customPaymentTypeIds.map(id => ({ id }))
    };
  }
  if (Array.isArray(customOrderTypeIds)) {
    relations.customOrderTypes = {
      connect: customOrderTypeIds.map(id => ({ id }))
    };
  }

  return db.branch.create({
    data: {
      ...insertData,
      ...relations
    },
    include: {
      locationGroup: true,
      customPaymentTypes: true,
      customOrderTypes: true
    }
  });
};

const update = async (db, id, data) => {
  const current = await getById(db, id);
  const { customPaymentTypeIds, customOrderTypeIds, ...rest } = data;
  const updatedData = { ...rest };

  const checkToggle = (field, subField) => {
    if (data[field] !== undefined && data[field] !== current[field]) {
      if (data[field] === true) {
        updatedData[subField] = new Date();
      } else {
        updatedData[subField] = null;
      }
    }
  };

  checkToggle("tablesEnabled", "tablesSubscribedAt");
  checkToggle("posEnabled", "posSubscribedAt");
  checkToggle("qrEnabled", "qrSubscribedAt");
  checkToggle("kdsEnabled", "kdsSubscribedAt");
  checkToggle("cdsEnabled", "cdsSubscribedAt");
  checkToggle("appServiEnabled", "appServiSubscribedAt");

  const relations = {};
  if (customPaymentTypeIds !== undefined) {
    relations.customPaymentTypes = {
      set: Array.isArray(customPaymentTypeIds) ? customPaymentTypeIds.map(id => ({ id })) : []
    };
  }
  if (customOrderTypeIds !== undefined) {
    relations.customOrderTypes = {
      set: Array.isArray(customOrderTypeIds) ? customOrderTypeIds.map(id => ({ id })) : []
    };
  }

  return db.branch.update({
    where: { id },
    data: {
      ...updatedData,
      ...relations
    },
    include: {
      tables: true,
      staff: true,
      locationGroup: true,
      customPaymentTypes: true,
      customOrderTypes: true
    }
  });
};

const remove = async (db, id) => {
  await getById(db, id);
  return db.branch.delete({ where: { id } });
};

const bulkUpdate = async (db, ids, data) => {
  return db.branch.updateMany({ where: { id: { in: ids } }, data });
};

module.exports = { getAll, getById, create, update, remove, bulkUpdate };
