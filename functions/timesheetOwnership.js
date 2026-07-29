"use strict";

function cleanString(value) {
  return String(
    value == null
      ? ""
      : value
  ).trim();
}

function firstNonEmpty(...values) {
  for (
    const value of
    values
  ) {
    const cleaned =
      cleanString(value);

    if (cleaned) {
      return cleaned;
    }
  }

  return "";
}

/**
 * Derive timesheet ownership only from the
 * authoritative stored shift.
 *
 * Browser-submitted client identifiers are never
 * accepted by this resolver.
 */
function resolveTimesheetClientOwnership(
  shift
) {
  const source =
    shift &&
    typeof shift === "object"
      ? shift
      : {};

  const clientId =
    firstNonEmpty(
      source.clientId,
      source.clientUid,
      source.clientUserId,
      source.createdBy,
      source.createdByUid
    );

  const clientEmail =
    firstNonEmpty(
      source.clientEmail,
      source.email
    );

  const clientOrganisation =
    firstNonEmpty(
      source.clientOrganisation,
      source.organisationName,
      source.organizationName,
      source.companyName,
      source.clientCompanyName,
      source.clientName
    );

  const clientPublicId =
    firstNonEmpty(
      source.clientPublicId,
      source.clientCode
    );

  return {
    clientId:
      clientId || null,

    clientUid:
      clientId || null,

    clientUserId:
      clientId || null,

    clientEmail:
      clientEmail || null,

    clientOrganisation:
      clientOrganisation || null,

    clientPublicId:
      clientPublicId || null,
  };
}

module.exports = {
  resolveTimesheetClientOwnership,
};