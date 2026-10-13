const categoriesService = require("../../web/admin/categories/categories.service");

const getCategories = async (req, res, next) => {
  try {
    const activeOnly = req.query.includeDisabled !== "true";
    const categories = await categoriesService.getAll({ activeOnly });
    res.json({
      success: true,
      data: categories,
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCategories,
};
