const { createHandler } = require('@app-core/server');
const deleteCreatorCard = require('@app/services/creator-cards/delete');

module.exports = createHandler({
  path: '/creator-cards/:slug',
  method: 'delete',
  middlewares: [],
  async handler(rc, helpers) {
    const payload = {
      slug: rc.params.slug,
      ...rc.body,
    };
    
    const response = await deleteCreatorCard(payload);

    return {
      status: helpers.http_statuses.HTTP_200_OK,
      message: 'Creator Card Deleted Successfully.',
      data: response,
    };
  },
});
