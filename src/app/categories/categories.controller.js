const categoriesService = require("../../web/admin/categories/categories.service");

const getCategories = async (req, res, next) => {
  try {
    const categories = await categoriesService.getAll();
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
