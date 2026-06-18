const validator = require('@app-core/validator');
const { throwAppError } = require('@app-core/errors');
const { appLogger } = require('@app-core/logger');
const { CreatorCard } = require('@app/models');
const CreatorCardMessages = require('@app/messages/creator-card');

const spec = `root {
  slug string<trim>
  access_code? string<trim>
}`;

const parsedSpec = validator.parse(spec);

async function getCreatorCard(serviceData, options = {}) {
  let response;
  const data = validator.validate(serviceData, parsedSpec);

  try {
    const card = await CreatorCard.findOne({ slug: data.slug });

    // 1. If no card with that slug exists -> HTTP 404, error code NF01
    // Also, if deleted, it must return NF01 (soft delete)
    if (!card || card.deleted) {
      throwAppError(CreatorCardMessages.CARD_NOT_FOUND, 'NF01');
    }

    // 2. If the card exists but its status is draft -> HTTP 404, error code NF02
    if (card.status === 'draft') {
      throwAppError(CreatorCardMessages.CARD_NOT_FOUND, 'NF02');
    }

    // 3. If the card is private and no access_code query parameter was supplied -> HTTP 403, error code AC03
    if (card.access_type === 'private' && !data.access_code) {
      throwAppError(CreatorCardMessages.PRIVATE_CARD, 'AC03');
    }

    // 4. If the card is private and the supplied access_code does not match -> HTTP 403, error code AC04
    if (card.access_type === 'private' && card.access_code !== data.access_code) {
      throwAppError(CreatorCardMessages.INVALID_ACCESS_CODE, 'AC04');
    }

    // 5. Otherwise -> HTTP 200 with the card data
    response = {
      id: card._id,
      title: card.title,
      description: card.description,
      slug: card.slug,
      creator_reference: card.creator_reference,
      links: card.links,
      service_rates: card.service_rates,
      status: card.status,
      access_type: card.access_type,
      // access_code is explicitly omitted
      created: card.created,
      updated: card.updated,
      deleted: card.deleted,
    };
  } catch (error) {
    appLogger.errorX(error, 'get-creator-card-error');
    throw error;
  }

  return response;
}

module.exports = getCreatorCard;
