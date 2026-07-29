const catchAsync = require("../../utils/catchAsync");
const branchesService = require("./branches.service");
const { getAppImageURL } = require("../../config");

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
      }
    } 
  });
});

const getStaff = catchAsync(async (req, res) => {
  const staff = await branchesService.getBranchStaff(req.tenantDb, req.params.branchId);
  res.json({ success: true, data: staff });
});

const getStaffSlots = catchAsync(async (req, res) => {
  const { date, duration } = req.query;
  const slots = await branchesService.getStaffSlots(req.tenantDb, req.params.staffId, date, duration);
  res.json({ success: true, data: slots });
});

module.exports = { getAll, getOne, getStaff, getStaffSlots };

