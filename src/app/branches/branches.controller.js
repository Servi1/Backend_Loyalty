const catchAsync = require("../../utils/catchAsync");
const branchesService = require("./branches.service");
const { getAppImageURL } = require("../../config");
const { encodeQrToken, decodeQrToken } = require("../../utils/qrToken.utils");

const getAll = catchAsync(async (req, res) => {
  const branches = await branchesService.getBranches(req.tenantDb);
  const data = branches.map(branch => ({
    ...branch,
    imageUrl: getAppImageURL(branch.imageUrl),
    menuBannerUrl: getAppImageURL(branch.menuBannerUrl),
    receiptLogoUrl: getAppImageURL(branch.receiptLogoUrl),
    tenantFeatures: {
      subQrTable: req.tenant.subQrTable,
      subQrCashier: req.tenant.subQrCashier,
      subPos: req.tenant.subPos,
      subKds: req.tenant.subKds,
      subCds: req.tenant.subCds
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
    }
  }));
  res.json({ success: true, data });
});

const getOne = catchAsync(async (req, res) => {
  const branch = await branchesService.getBranch(req.tenantDb, req.params.branchId);
  res.json({ 
    success: true, 
    data: {
      ...branch,
      imageUrl: getAppImageURL(branch.imageUrl),
      menuBannerUrl: getAppImageURL(branch.menuBannerUrl),
      receiptLogoUrl: getAppImageURL(branch.receiptLogoUrl),
      tenantFeatures: {
        subQrTable: req.tenant.subQrTable,
        subQrCashier: req.tenant.subQrCashier,
        subPos: req.tenant.subPos,
        subKds: req.tenant.subKds,
        subCds: req.tenant.subCds
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
  const { date, duration } = req.query;
  const slots = await branchesService.getStaffSlots(req.tenantDb, req.params.staffId, date, duration);
  res.json({ success: true, data: slots });
});

const getScheduleSlots = catchAsync(async (req, res) => {
  const { date, duration } = req.query;
  const data = await branchesService.getBranchScheduleSlots(
    req.tenantDb,
    req.params.branchId,
    date,
    parseInt(duration) || 60
  );
  res.json({ success: true, data });
});

const resolveQrToken = catchAsync(async (req, res) => {
  const token = req.query.token || req.body.token;
  if (!token) {
    return res.status(400).json({ success: false, message: "Token parameter is required" });
  }
  try {
    const payload = decodeQrToken(token);
    res.json({ success: true, data: payload });
  } catch (err) {
    res.status(400).json({ success: false, message: err.message });
  }
});

const encodeQrTokenEndpoint = catchAsync(async (req, res) => {
  const { tenantId, branchId, tableId, qrCashierId, orderTypeId } = req.body;
  if (!tenantId || !branchId) {
    return res.status(400).json({ success: false, message: "tenantId and branchId are required" });
  }
  const token = encodeQrToken({ tenantId, branchId, tableId, qrCashierId, orderTypeId });
  res.json({ success: true, token });
});

module.exports = { getAll, getOne, getStaff, getStaffSlots, getScheduleSlots, resolveQrToken, encodeQrTokenEndpoint };


