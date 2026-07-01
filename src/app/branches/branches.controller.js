const catchAsync = require("../../utils/catchAsync");
const branchesService = require("./branches.service");

const getAll = catchAsync(async (req, res) => {
  const branches = await branchesService.getBranches(req.tenantDb);
  const data = branches.map(branch => ({
    ...branch,
    tenantFeatures: {
      subQrTable: req.tenant.subQrTable,
      subQrCashier: req.tenant.subQrCashier,
      subPos: req.tenant.subPos,
      subKds: req.tenant.subKds,
      subCds: req.tenant.subCds
    },
    tenantSettings: {
      logoUrl: req.tenant.logoUrl,
      bannerUrl: req.tenant.bannerUrl,
      bannerUrl2: req.tenant.bannerUrl2,
      bannerUrl3: req.tenant.bannerUrl3,
      menuBannerUrl: req.tenant.menuBannerUrl,
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
      tenantFeatures: {
        subQrTable: req.tenant.subQrTable,
        subQrCashier: req.tenant.subQrCashier,
        subPos: req.tenant.subPos,
        subKds: req.tenant.subKds,
        subCds: req.tenant.subCds
      },
      tenantSettings: {
        logoUrl: req.tenant.logoUrl,
        bannerUrl: req.tenant.bannerUrl,
        bannerUrl2: req.tenant.bannerUrl2,
        bannerUrl3: req.tenant.bannerUrl3,
        menuBannerUrl: req.tenant.menuBannerUrl,
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

module.exports = { getAll, getOne };
