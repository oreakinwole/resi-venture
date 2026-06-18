const validator = require('@app-core/validator');
const { throwAppError, ERROR_CODE } = require('@app-core/errors');
const { appLogger } = require('@app-core/logger');
const { ulid } = require('@app-core/randomness');
const { CreatorCard } = require('@app/models');
const CreatorCardMessages = require('@app/messages/creator-card');

// --- Specs ---

const createSpec = `root {
  title string<trim|minLength:3|maxLength:100>
  description? string<trim|maxLength:500>
  slug? string<trim|minLength:5|maxLength:50>
  creator_reference string<trim|length:20>
  links[]? {
    title string<trim|minLength:1|maxLength:100>
    url string<trim|maxLength:200|startsWith:http>
  }
  service_rates? {
    currency string(NGN|USD|GBP|GHS)
    rates[] {
      name string<trim|minLength:3|maxLength:100>
      description string<trim|maxLength:250>
      amount number<min:1>
    }
  }
  status string(draft|published)
  access_type? string(public|private)
  access_code? string<trim|length:6>
}`;

const getSpec = `root {
  slug string<trim>
  access_code? string<trim>
}`;

const deleteSpec = `root {
  slug string<trim>
  creator_reference string<trim|length:20>
}`;

const parsedCreateSpec = validator.parse(createSpec);
const parsedGetSpec = validator.parse(getSpec);
const parsedDeleteSpec = validator.parse(deleteSpec);

// --- Helpers ---

function isAlphanumeric(str) {
  if (!str) return false;
  for (let i = 0; i < str.length; i++) {
    const code = str.charCodeAt(i);
    if (!(code > 47 && code < 58) && !(code > 64 && code < 91) && !(code > 96 && code < 123)) {
      return false;
    }
  }
  return true;
}

function isValidSlugChar(char) {
  const code = char.charCodeAt(0);
  return (code > 47 && code < 58) || (code > 64 && code < 91) || (code > 96 && code < 123) || code === 45 || code === 95;
}

function generateSlugBase(title) {
  let base = '';
  const lower = title.toLowerCase();
  for (let i = 0; i < lower.length; i++) {
    const c = lower[i];
    if (c === ' ') {
      base += '-';
    } else if (isValidSlugChar(c)) {
      base += c;
    }
  }
  return base;
}

function generateRandomSuffix() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < 6; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// --- Services ---

async function createCreatorCard(serviceData, options = {}) {
  let response;
  const data = validator.validate(serviceData, parsedCreateSpec);

  try {
    // Custom Validations
    if (data.links && data.links.length > 0) {
      for (const link of data.links) {
        if (!link.url.startsWith('http://') && !link.url.startsWith('https://')) {
          throwAppError('URL must start with http:// or https://', ERROR_CODE.VALIDATIONERR);
        }
      }
    }

    if (data.service_rates && data.service_rates.rates) {
      if (data.service_rates.rates.length === 0) {
        throwAppError('Rates must be a non-empty array', ERROR_CODE.VALIDATIONERR);
      }
      for (const rate of data.service_rates.rates) {
        if (!Number.isInteger(rate.amount)) {
          throwAppError('Amount must be a positive integer', ERROR_CODE.VALIDATIONERR);
        }
      }
    }

    const accessType = data.access_type || 'public';
    if (accessType === 'private') {
      if (!data.access_code) {
        throwAppError(CreatorCardMessages.ACCESS_CODE_REQUIRED, 'AC01');
      }
      if (!isAlphanumeric(data.access_code)) {
        throwAppError('access_code must be alphanumeric', ERROR_CODE.VALIDATIONERR);
      }
    } else {
      if (data.access_code !== undefined && data.access_code !== null) {
        throwAppError(CreatorCardMessages.ACCESS_CODE_FORBIDDEN, 'AC05');
      }
    }

    let slug = data.slug;
    if (slug) {
      // Validate client provided slug manually to ensure chars
      for (let i = 0; i < slug.length; i++) {
        if (!isValidSlugChar(slug[i])) {
          throwAppError('Slug contains invalid characters', ERROR_CODE.VALIDATIONERR);
        }
      }
      const existing = await CreatorCard.findOne({ slug });
      if (existing) {
        throwAppError(CreatorCardMessages.SLUG_TAKEN, 'SL02');
      }
    } else {
      // Auto-generate
      let base = generateSlugBase(data.title);
      slug = base;
      if (slug.length < 5) {
        slug = `${slug}-${generateRandomSuffix()}`;
      } else {
        const existing = await CreatorCard.findOne({ slug });
        if (existing) {
          slug = `${slug}-${generateRandomSuffix()}`;
        }
      }
      // Check again to be safe in a highly unlikely collision scenario
      const existingCheck = await CreatorCard.findOne({ slug });
      if (existingCheck) {
        slug = `${slug}-${generateRandomSuffix()}`;
      }
    }

    const id = ulid();
    const now = Date.now();

    const cardDoc = {
      _id: id,
      title: data.title,
      description: data.description,
      slug: slug,
      creator_reference: data.creator_reference,
      links: data.links,
      service_rates: data.service_rates,
      status: data.status,
      access_type: accessType,
      access_code: data.access_code,
      created: now,
      updated: now,
      deleted: null,
    };

    await CreatorCard.create(cardDoc);

    response = {
      id: cardDoc._id,
      title: cardDoc.title,
      description: cardDoc.description,
      slug: cardDoc.slug,
      creator_reference: cardDoc.creator_reference,
      links: cardDoc.links,
      service_rates: cardDoc.service_rates,
      status: cardDoc.status,
      access_type: cardDoc.access_type,
      access_code: cardDoc.access_code,
      created: cardDoc.created,
      updated: cardDoc.updated,
      deleted: cardDoc.deleted,
    };
  } catch (error) {
    appLogger.errorX(error, 'create-creator-card-error');
    throw error;
  }

  return response;
}

async function getCreatorCard(serviceData, options = {}) {
  let response;
  const data = validator.validate(serviceData, parsedGetSpec);

  try {
    const card = await CreatorCard.findOne({ slug: data.slug });

    if (!card || card.deleted) {
      throwAppError(CreatorCardMessages.CARD_NOT_FOUND, 'NF01');
    }

    if (card.status === 'draft') {
      throwAppError(CreatorCardMessages.CARD_NOT_FOUND, 'NF02');
    }

    if (card.access_type === 'private' && !data.access_code) {
      throwAppError(CreatorCardMessages.PRIVATE_CARD, 'AC03');
    }

    if (card.access_type === 'private' && card.access_code !== data.access_code) {
      throwAppError(CreatorCardMessages.INVALID_ACCESS_CODE, 'AC04');
    }

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
      // access_code explicitly omitted
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

async function deleteCreatorCard(serviceData, options = {}) {
  let response;
  const data = validator.validate(serviceData, parsedDeleteSpec);

  try {
    const card = await CreatorCard.findOne({ slug: data.slug });

    if (!card || card.deleted) {
      throwAppError(CreatorCardMessages.CARD_NOT_FOUND, 'NF01');
    }

    if (card.creator_reference !== data.creator_reference) {
       throwAppError(CreatorCardMessages.CARD_NOT_FOUND, 'NF01');
    }

    card.deleted = Date.now();
    await CreatorCard.updateOne({ _id: card._id }, { $set: { deleted: card.deleted } });

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
      access_code: card.access_code,
      created: card.created,
      updated: card.updated,
      deleted: card.deleted,
    };
  } catch (error) {
    appLogger.errorX(error, 'delete-creator-card-error');
    throw error;
  }

  return response;
}

module.exports = {
  createCreatorCard,
  getCreatorCard,
  deleteCreatorCard,
};
