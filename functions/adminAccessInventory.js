"use strict";

const {
  ASSIGNABLE_PRESET_VALUES,
  PROTECTED_SUPER_ADMIN_EMAILS,
} =
  require(
    "./adminAuthorization"
  );

const INVENTORY_CATEGORIES =
  Object.freeze({
    PROTECTED_SUPER_ADMIN:
      "protected_super_admin",

    STRUCTURED_ADMIN:
      "structured_admin",

    STRUCTURED_DISABLED:
      "structured_disabled",

    LEGACY_ADMIN:
      "legacy_admin",

    LEGACY_DISABLED:
      "legacy_disabled",

    INVALID_STRUCTURED_ADMIN:
      "invalid_structured_admin",

    NON_ADMIN:
      "non_admin",
  });

const CATEGORY_VALUES =
  Object.freeze(
    Object.values(
      INVENTORY_CATEGORIES
    )
  );

const CATEGORY_PRIORITY =
  Object.freeze({
    invalid_structured_admin:
      1,

    legacy_admin:
      2,

    legacy_disabled:
      3,

    structured_admin:
      4,

    structured_disabled:
      5,

    protected_super_admin:
      6,

    non_admin:
      7,
  });

const assignablePresetSet =
  new Set(
    ASSIGNABLE_PRESET_VALUES
  );

const protectedEmailSet =
  new Set(
    PROTECTED_SUPER_ADMIN_EMAILS
      .map(normaliseEmail)
  );

function normaliseText(
  value
) {
  return String(
    value ??
      ""
  ).trim();
}

function normaliseEmail(
  value
) {
  return normaliseText(
    value
  ).toLowerCase();
}

function isPlainObject(
  value
) {
  return (
    value !== null &&
    typeof value ===
      "object" &&
    !Array.isArray(
      value
    )
  );
}

function normaliseProfileRecord(
  record
) {
  if (
    isPlainObject(
      record?.data
    )
  ) {
    return {
      id:
        normaliseText(
          record.id ||
            record.data.uid
        ),

      profile:
        record.data,
    };
  }

  const profile =
    isPlainObject(
      record
    )
      ? record
      : {};

  return {
    id:
      normaliseText(
        profile.id ||
          profile.uid
      ),

    profile,
  };
}

function profileStatus(
  profile
) {
  return normaliseText(
    profile?.status
  ).toLowerCase();
}

function profileIsDisabled(
  profile,
  adminAccess
) {
  return (
    profile?.isActive ===
      false ||
    [
      "disabled",
      "inactive",
      "suspended",
    ].includes(
      profileStatus(
        profile
      )
    ) ||
    adminAccess?.enabled ===
      false ||
    adminAccess?.active ===
      false
  );
}

function adminIdentitySignals(
  profile,
  adminAccess
) {
  const role =
    normaliseText(
      profile?.role
    ).toLowerCase();

  const accountType =
    normaliseText(
      profile?.accountType
    ).toLowerCase();

  const signals = [];

  if (
    role ===
      "admin"
  ) {
    signals.push(
      "role"
    );
  }

  if (
    accountType ===
      "admin"
  ) {
    signals.push(
      "accountType"
    );
  }

  if (
    profile?.isAdmin ===
      true
  ) {
    signals.push(
      "isAdmin"
    );
  }

  if (
    isPlainObject(
      adminAccess
    ) &&
    Object.keys(
      adminAccess
    ).length >
      0
  ) {
    signals.push(
      "adminAccess"
    );
  }

  return signals;
}

function structuredAccessIsValid(
  adminAccess
) {
  if (
    !isPlainObject(
      adminAccess
    )
  ) {
    return false;
  }

  const preset =
    normaliseText(
      adminAccess.preset
    ).toLowerCase();

  if (
    Number(
      adminAccess.version ||
        0
    ) <
      1
  ) {
    return false;
  }

  if (
    !assignablePresetSet.has(
      preset
    )
  ) {
    return false;
  }

  if (
    typeof adminAccess.enabled !==
      "boolean" ||
    typeof adminAccess.active !==
      "boolean"
  ) {
    return false;
  }

  if (
    adminAccess.assignedClientIds !==
      undefined &&
    !Array.isArray(
      adminAccess.assignedClientIds
    )
  ) {
    return false;
  }

  if (
    adminAccess.permissions !==
      undefined &&
    !isPlainObject(
      adminAccess.permissions
    )
  ) {
    return false;
  }

  return true;
}

function profileName(
  profile
) {
  return normaliseText(
    profile?.fullName ||
      profile?.displayName ||
      profile?.name ||
      profile?.organisationName
  );
}

function recommendationForCategory(
  category
) {
  switch (
    category
  ) {
    case INVENTORY_CATEGORIES
      .LEGACY_ADMIN:
      return {
        migrationRequired:
          true,

        blocksScopedAccess:
          true,

        recommendedAction:
          "review_and_assign_preset",

        suggestedPreset:
          "operations_admin",
      };

    case INVENTORY_CATEGORIES
      .LEGACY_DISABLED:
      return {
        migrationRequired:
          true,

        blocksScopedAccess:
          true,

        recommendedAction:
          "review_and_confirm_disabled",

        suggestedPreset:
          null,
      };

    case INVENTORY_CATEGORIES
      .INVALID_STRUCTURED_ADMIN:
      return {
        migrationRequired:
          true,

        blocksScopedAccess:
          true,

        recommendedAction:
          "repair_or_disable",

        suggestedPreset:
          null,
      };

    default:
      return {
        migrationRequired:
          false,

        blocksScopedAccess:
          false,

        recommendedAction:
          "none",

        suggestedPreset:
          null,
      };
  }
}

function classifyAdminProfile(
  record
) {
  const {
    id,
    profile,
  } =
    normaliseProfileRecord(
      record
    );

  const email =
    normaliseEmail(
      profile.email
    );

  const adminAccess =
    isPlainObject(
      profile.adminAccess
    )
      ? profile.adminAccess
      : {};

  const signals =
    adminIdentitySignals(
      profile,
      adminAccess
    );

  const protectedAccount =
    protectedEmailSet.has(
      email
    );

  const disabled =
    profileIsDisabled(
      profile,
      adminAccess
    );

  const hasAdminSignals =
    signals.length >
      0;

  const validStructuredAccess =
    structuredAccessIsValid(
      adminAccess
    );

  let category;

  if (
    protectedAccount
  ) {
    category =
      INVENTORY_CATEGORIES
        .PROTECTED_SUPER_ADMIN;
  } else if (
    validStructuredAccess &&
    disabled
  ) {
    category =
      INVENTORY_CATEGORIES
        .STRUCTURED_DISABLED;
  } else if (
    validStructuredAccess
  ) {
    category =
      INVENTORY_CATEGORIES
        .STRUCTURED_ADMIN;
  } else if (
    hasAdminSignals &&
    signals.includes(
      "adminAccess"
    )
  ) {
    category =
      INVENTORY_CATEGORIES
        .INVALID_STRUCTURED_ADMIN;
  } else if (
    hasAdminSignals &&
    disabled
  ) {
    category =
      INVENTORY_CATEGORIES
        .LEGACY_DISABLED;
  } else if (
    hasAdminSignals
  ) {
    category =
      INVENTORY_CATEGORIES
        .LEGACY_ADMIN;
  } else {
    category =
      INVENTORY_CATEGORIES
        .NON_ADMIN;
  }

  const recommendation =
    recommendationForCategory(
      category
    );

  return {
    uid:
      id,

    email,

    name:
      profileName(
        profile
      ),

    role:
      normaliseText(
        profile.role
      ).toLowerCase(),

    accountType:
      normaliseText(
        profile.accountType
      ).toLowerCase(),

    isAdmin:
      profile.isAdmin ===
        true,

    isActive:
      profile.isActive !==
        false,

    status:
      profileStatus(
        profile
      ),

    category,

    protectedAccount,

    disabled,

    identitySignals:
      [...signals],

    currentPreset:
      normaliseText(
        adminAccess.preset
      ).toLowerCase() ||
      null,

    structuredAccessValid:
      validStructuredAccess,

    migrationRequired:
      recommendation
        .migrationRequired,

    blocksScopedAccess:
      recommendation
        .blocksScopedAccess,

    recommendedAction:
      recommendation
        .recommendedAction,

    suggestedPreset:
      recommendation
        .suggestedPreset,
  };
}

function compareInventoryItems(
  first,
  second
) {
  const categoryDifference =
    (
      CATEGORY_PRIORITY[
        first.category
      ] ||
      99
    ) -
    (
      CATEGORY_PRIORITY[
        second.category
      ] ||
      99
    );

  if (
    categoryDifference !==
      0
  ) {
    return categoryDifference;
  }

  return [
    first.name,
    first.email,
    first.uid,
  ]
    .join(
      "\u0000"
    )
    .localeCompare(
      [
        second.name,
        second.email,
        second.uid,
      ].join(
        "\u0000"
      ),
      "en-GB"
    );
}

function buildAdminAccessInventory(
  records
) {
  const source =
    Array.isArray(
      records
    )
      ? records
      : [];

  const items =
    source
      .map(
        classifyAdminProfile
      )
      .sort(
        compareInventoryItems
      );

  const counts =
    Object.fromEntries(
      CATEGORY_VALUES.map(
        (
          category
        ) => [
          category,
          0,
        ]
      )
    );

  for (
    const item of
    items
  ) {
    counts[
      item.category
    ] += 1;
  }

  return {
    total:
      items.length,

    counts,

    migrationRequiredCount:
      items.filter(
        (
          item
        ) =>
          item
            .migrationRequired
      ).length,

    blockedByStructuredRulesCount:
      items.filter(
        (
          item
        ) =>
          item
            .blocksScopedAccess
      ).length,

    items,
  };
}

module.exports = {
  CATEGORY_VALUES,
  INVENTORY_CATEGORIES,
  buildAdminAccessInventory,
  classifyAdminProfile,
  normaliseEmail,
  structuredAccessIsValid,
};