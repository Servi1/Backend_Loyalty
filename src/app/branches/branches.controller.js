const catchAsync = require("../../utils/catchAsync");
const branchesService = require("./branches.service");
const { getAppImageURL } = require("../../config");
const { encodeQrToken, decodeQrToken } = require("../../utils/qrToken.utils");
const mainPrisma = require("../../config/prisma");
const { getTenantClient } = require("../../config/tenantManager");

const getAll = catchAsync(async (req, res) => {
  const branches = await branchesService.getBranches(req.tenantDb);
  let redeemEligibleIds = req.tenant?.loyaltyRedeemEligibleItemIds;
  let redeemEligibleNames = req.tenant?.loyaltyRedeemEligibleItemNames;
  if ((redeemEligibleIds === undefined || redeemEligibleIds === null) && req.tenant?.id) {
    try {
      const rows = await mainPrisma.$queryRawUnsafe(
        'SELECT "loyaltyRedeemEligibleItemIds", "loyaltyRedeemEligibleItemNames" FROM "Tenant" WHERE id = $1',
        req.tenant.id
      );
      if (rows && rows[0]) {
        redeemEligibleIds = rows[0].loyaltyRedeemEligibleItemIds || null;
        redeemEligibleNames = rows[0].loyaltyRedeemEligibleItemNames || null;
      }
    } catch (_) {}
  }

  const isLoyaltySubscribed = Boolean(req.tenant?.subLoyalty);
  const isLoyaltyEnabled = isLoyaltySubscribed && Boolean(req.tenant?.loyaltyEnabled);
  const hasEligibleItems = Array.isArray(req.tenant?.loyaltyEligibleItemIds) && req.tenant.loyaltyEligibleItemIds.length > 0;
  const isLoyaltyAddPoints = isLoyaltyEnabled && (req.tenant?.loyaltyAddPoints !== false) && hasEligibleItems;
  const isLoyaltyRedeemPoints = isLoyaltyEnabled && (req.tenant?.loyaltyRedeemPoints !== false);
  const earnRate = isLoyaltyAddPoints ? Number(req.tenant?.loyaltyEarnRate !== undefined && req.tenant?.loyaltyEarnRate !== null ? req.tenant.loyaltyEarnRate : 1.0) : 0.0;
  const redeemRate = Number(req.tenant?.loyaltyRedeemRate || 100.0);

  const data = branches.map(branch => ({
    ...branch,
    loyaltyEnabled: isLoyaltyEnabled,
    loyaltyAddPoints: isLoyaltyAddPoints,
    loyaltyRedeemPoints: isLoyaltyRedeemPoints,
    loyaltyEarnRate: earnRate,
    loyaltyRedeemRate: redeemRate,
    loyaltyRedeemEligibleItemIds: redeemEligibleIds || null,
    loyaltyRedeemEligibleItemNames: redeemEligibleNames || null,
    imageUrl: getAppImageURL(branch.imageUrl),
    menuBannerUrl: getAppImageURL(branch.menuBannerUrl),
    receiptLogoUrl: getAppImageURL(branch.receiptLogoUrl),
    tenantFeatures: {
      subQrTable: req.tenant.subQrTable,
      subQrCashier: req.tenant.subQrCashier,
      subPos: req.tenant.subPos,
      subKds: req.tenant.subKds,
      subCds: req.tenant.subCds,
      subAppServi: req.tenant.subAppServi,
      ordersEnabled: req.tenant.ordersEnabled
    },
    tenantSettings: {
      logoUrl: getAppImageURL(req.tenant.logoUrl),
      bannerUrl: getAppImageURL(req.tenant.bannerUrl),
      bannerUrl2: getAppImageURL(req.tenant.bannerUrl2),
      bannerUrl3: getAppImageURL(req.tenant.bannerUrl3),
      menuBannerUrl: getAppImageURL(req.tenant.menuBannerUrl),
      primaryColor: req.tenant.primaryColor,
      accentColor: req.tenant.accentColor,
      fontFamily: req.tenant.fontFamily,
      layoutStyle: req.tenant.layoutStyle,
      showHero: req.tenant.showHero,
      heroTitle: req.tenant.heroTitle,
      heroSubtitle: req.tenant.heroSubtitle,
      vatPercentage: req.tenant.vatPercentage,
      loyaltyRedeemEligibleItemIds: redeemEligibleIds || null,
      loyaltyRedeemEligibleItemNames: redeemEligibleNames || null,
    }
  }));
  res.json({ success: true, data });
});

const getOne = catchAsync(async (req, res) => {
  const branch = await branchesService.getBranch(req.tenantDb, req.params.branchId);
  let redeemEligibleIds = req.tenant?.loyaltyRedeemEligibleItemIds;
  let redeemEligibleNames = req.tenant?.loyaltyRedeemEligibleItemNames;
  if ((redeemEligibleIds === undefined || redeemEligibleIds === null) && req.tenant?.id) {
    try {
      const rows = await mainPrisma.$queryRawUnsafe(
        'SELECT "loyaltyRedeemEligibleItemIds", "loyaltyRedeemEligibleItemNames" FROM "Tenant" WHERE id = $1',
        req.tenant.id
      );
      if (rows && rows[0]) {
        redeemEligibleIds = rows[0].loyaltyRedeemEligibleItemIds || null;
        redeemEligibleNames = rows[0].loyaltyRedeemEligibleItemNames || null;
      }
    } catch (_) {}
  }

  const isLoyaltySubscribed = Boolean(req.tenant?.subLoyalty);
  const isLoyaltyEnabled = isLoyaltySubscribed && Boolean(req.tenant?.loyaltyEnabled);
  const hasEligibleItems = Array.isArray(req.tenant?.loyaltyEligibleItemIds) && req.tenant.loyaltyEligibleItemIds.length > 0;
  const isLoyaltyAddPoints = isLoyaltyEnabled && (req.tenant?.loyaltyAddPoints !== false) && hasEligibleItems;
  const isLoyaltyRedeemPoints = isLoyaltyEnabled && (req.tenant?.loyaltyRedeemPoints !== false);
  const earnRate = isLoyaltyAddPoints ? Number(req.tenant?.loyaltyEarnRate !== undefined && req.tenant?.loyaltyEarnRate !== null ? req.tenant.loyaltyEarnRate : 1.0) : 0.0;
  const redeemRate = Number(req.tenant?.loyaltyRedeemRate || 100.0);

  res.json({ 
    success: true, 
    data: {
      ...branch,
      loyaltyEnabled: isLoyaltyEnabled,
      loyaltyAddPoints: isLoyaltyAddPoints,
      loyaltyRedeemPoints: isLoyaltyRedeemPoints,
      loyaltyEarnRate: earnRate,
      loyaltyRedeemRate: redeemRate,
      loyaltyRedeemEligibleItemIds: redeemEligibleIds || null,
      loyaltyRedeemEligibleItemNames: redeemEligibleNames || null,
      imageUrl: getAppImageURL(branch.imageUrl),
      menuBannerUrl: getAppImageURL(branch.menuBannerUrl),
      receiptLogoUrl: getAppImageURL(branch.receiptLogoUrl),
      tenantFeatures: {
        subQrTable: req.tenant.subQrTable,
        subQrCashier: req.tenant.subQrCashier,
        subPos: req.tenant.subPos,
        subKds: req.tenant.subKds,
        subCds: req.tenant.subCds,
        subAppServi: req.tenant.subAppServi,
        ordersEnabled: req.tenant.ordersEnabled
      },
      tenantSettings: {
        logoUrl: getAppImageURL(req.tenant.logoUrl),
        bannerUrl: getAppImageURL(req.tenant.bannerUrl),
        bannerUrl2: getAppImageURL(req.tenant.bannerUrl2),
        bannerUrl3: getAppImageURL(req.tenant.bannerUrl3),
        menuBannerUrl: getAppImageURL(req.tenant.menuBannerUrl),
        primaryColor: req.tenant.primaryColor,
        accentColor: req.tenant.accentColor,
        fontFamily: req.tenant.fontFamily,
        layoutStyle: req.tenant.layoutStyle,
        showHero: req.tenant.showHero,
        heroTitle: req.tenant.heroTitle,
        heroSubtitle: req.tenant.heroSubtitle,
        vatPercentage: req.tenant.vatPercentage,
        loyaltyRedeemEligibleItemIds: redeemEligibleIds || null,
        loyaltyRedeemEligibleItemNames: redeemEligibleNames || null,
      }
    } 
  });
});

const getStaff = catchAsync(async (req, res) => {
  const staff = await branchesService.getBranchStaff(req.tenantDb, req.params.branchId);
  const data = staff.map(s => ({ ...s, avatarUrl: getAppImageURL(s.avatarUrl) }));
  res.json({ success: true, data });
});

const getStaffSlots = catchAsync(async (req, res) => {
  const { date, duration, includePast, clientMinutes } = req.query;
  const slots = await branchesService.getStaffSlots(
    req.tenantDb,
    req.params.staffId,
    date,
    duration,
    includePast === 'true',
    clientMinutes !== undefined ? parseInt(clientMinutes, 10) : undefined
  );
  res.json({ success: true, data: slots });
});

const getScheduleSlots = catchAsync(async (req, res) => {
  const { date, duration, tableId } = req.query;
  const data = await branchesService.getBranchScheduleSlots(
    req.tenantDb,
    req.params.branchId,
    date,
    parseInt(duration) || 60,
    tableId || null
  );
  res.json({ success: true, data });
});

const getBranchDiscounts = catchAsync(async (req, res) => {
  const discounts = await branchesService.getBranchDiscounts(req.tenantDb, req.params.branchId);
  res.json({ success: true, data: discounts });
});

const resolveQrToken = catchAsync(async (req, res) => {
  const token = req.query.token || req.body?.token;
  if (!token) {
    return res.status(400).json({ success: false, message: "Token parameter is required" });
  }
  try {
    const payload = decodeQrToken(token);

    let table = null;
    let branch = null;
    let tenantInfo = null;

    if (payload.tenantId) {
      try {
        const tenant = await mainPrisma.tenant.findUnique({
          where: { id: payload.tenantId },
          select: { id: true, name: true, nameAr: true, slug: true, dbUrl: true, logoUrl: true }
        });
        if (tenant) {
          tenantInfo = {
            id: tenant.id,
            name: tenant.name,
            nameAr: tenant.nameAr,
            slug: tenant.slug,
            logoUrl: getAppImageURL(tenant.logoUrl)
          };

          if (tenant.dbUrl) {
            const tenantDb = getTenantClient(tenant.dbUrl);

            if (payload.tableId) {
              const tableDoc = await tenantDb.table.findUnique({
                where: { id: payload.tableId }
              });
              if (tableDoc) {
                table = {
                  id: tableDoc.id,
                  label: tableDoc.label,
                  tableNumber: tableDoc.label,
                  labelAr: tableDoc.labelAr,
                  seats: tableDoc.seats,
                  zone: tableDoc.zone,
                  zoneAr: tableDoc.zoneAr,
                  branchId: tableDoc.branchId,
                  status: tableDoc.status || "free",
                  isActive: tableDoc.isActive !== false
                };
              }
            }

            if (payload.branchId) {
              const branchDoc = await tenantDb.branch.findUnique({
                where: { id: payload.branchId },
                select: { id: true, name: true, nameAr: true, address: true, phone: true }
              });
              if (branchDoc) {
                branch = branchDoc;
              }
            }
          }
        }
      } catch (dbErr) {
        console.warn("[resolveQrToken] Error fetching table/branch details:", dbErr.message);
      }
    }

    const tableNumber = table?.tableNumber || payload.tableNumber || payload.tableLabel || null;

    res.json({
      success: true,
      data: {
        ...payload,
        tableNumber,
        tableLabel: tableNumber,
        table,
        branch,
        tenant: tenantInfo
      }
    });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

const encodeQrTokenEndpoint = catchAsync(async (req, res) => {
  const { tenantId, branchId, tableId, tableNumber, tableLabel, qrCashierId, orderTypeId, stampId, type, customerId } = req.body;
  if (!tenantId) {
    return res.status(400).json({ success: false, message: "tenantId is required" });
  }
  const token = encodeQrToken({
    tenantId,
    branchId,
    tableId,
    tableNumber: tableNumber || tableLabel,
    tableLabel: tableLabel || tableNumber,
    qrCashierId,
    orderTypeId,
    stampId,
    type,
    customerId
  });
  res.json({ success: true, token });
});

const getBranchPager = catchAsync(async (req, res) => {
  const pagersService = require("../../web/tenant/pagers/pagers.service");
  await pagersService.ensureTables(req.tenantDb);
  const rows = await req.tenantDb.$queryRawUnsafe(`
    SELECT id, name, "nameAr", "deviceKey", "isActive"
    FROM "PagerDevice"
    WHERE "branchId" = $1 AND "isActive" = true
    ORDER BY "createdAt" ASC
    LIMIT 1
  `, req.params.branchId).catch(() => []);
  res.json({
    success: true,
    data: rows && rows.length > 0 ? rows[0] : null,
  });
});

module.exports = { getAll, getOne, getBranchPager, getStaff, getStaffSlots, getScheduleSlots, getBranchDiscounts, resolveQrToken, encodeQrTokenEndpoint };


