"use strict";

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function deepFreeze(value) {
  if (
    value === null ||
    typeof value !== "object" ||
    Object.isFrozen(value)
  ) {
    return value;
  }

  for (
    const propertyName of
    Object.getOwnPropertyNames(value)
  ) {
    deepFreeze(
      value[propertyName]
    );
  }

  return Object.freeze(value);
}

function normaliseText(value) {
  return String(value ?? "").trim();
}

function normaliseEmail(value) {
  return normaliseText(value)
    .toLowerCase();
}

function cleanClientIds(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) =>
          normaliseText(value)
        )
        .filter(
          (value) =>
            value &&
            !value.includes("/") &&
            value.length <= 256
        )
    ),
  ];
}

const ACCESS_SCOPES = deepFreeze({
  NONE: "none",
  ASSIGNED: "assigned",
  ALL: "all",
});

const validScopeSet = new Set(
  Object.values(ACCESS_SCOPES)
);

function normaliseScope(value) {
  const scope = normaliseText(
    value
  ).toLowerCase();

  return validScopeSet.has(scope)
    ? scope
    : ACCESS_SCOPES.NONE;
}

function clonePermissions(
  permissions
) {
  const source = isPlainObject(
    permissions
  )
    ? permissions
    : {};

  return {
    clients: {
      view: normaliseScope(
        source.clients?.view
      ),

      edit: normaliseScope(
        source.clients?.edit
      ),
    },

    shifts: {
      view: normaliseScope(
        source.shifts?.view
      ),

      create: normaliseScope(
        source.shifts?.create
      ),

      edit: normaliseScope(
        source.shifts?.edit
      ),

      assign: normaliseScope(
        source.shifts?.assign
      ),

      cancel: normaliseScope(
        source.shifts?.cancel
      ),
    },

    staffPortalAccess:
      source.staffPortalAccess === true,

    users: {
      view:
        source.users?.view === true,

      manage:
        source.users?.manage === true,
    },

    staffApplications: {
      view:
        source.staffApplications
          ?.view === true,

      manage:
        source.staffApplications
          ?.manage === true,
    },

    timesheets: {
      view: normaliseScope(
        source.timesheets?.view
      ),

      approve: normaliseScope(
        source.timesheets?.approve
      ),
    },

    invoices: {
      view: normaliseScope(
        source.invoices?.view
      ),

      manage: normaliseScope(
        source.invoices?.manage
      ),
    },

    payroll: {
      view:
        source.payroll?.view === true,

      manage:
        source.payroll?.manage === true,
    },

    adminManagement:
      source.adminManagement === true,
  };
}

function mergePermissions(
  base,
  custom = {}
) {
  const basePermissions =
    clonePermissions(base);

  const customPermissions =
    isPlainObject(custom)
      ? custom
      : {};

  return clonePermissions({
    clients: {
      ...basePermissions.clients,
      ...(isPlainObject(
        customPermissions.clients
      )
        ? customPermissions.clients
        : {}),
    },

    shifts: {
      ...basePermissions.shifts,
      ...(isPlainObject(
        customPermissions.shifts
      )
        ? customPermissions.shifts
        : {}),
    },

    staffPortalAccess:
      typeof customPermissions
        .staffPortalAccess === "boolean"
        ? customPermissions
            .staffPortalAccess
        : basePermissions
            .staffPortalAccess,

    users: {
      ...basePermissions.users,
      ...(isPlainObject(
        customPermissions.users
      )
        ? customPermissions.users
        : {}),
    },

    staffApplications: {
      ...basePermissions
        .staffApplications,

      ...(isPlainObject(
        customPermissions
          .staffApplications
      )
        ? customPermissions
            .staffApplications
        : {}),
    },

    timesheets: {
      ...basePermissions.timesheets,
      ...(isPlainObject(
        customPermissions.timesheets
      )
        ? customPermissions.timesheets
        : {}),
    },

    invoices: {
      ...basePermissions.invoices,
      ...(isPlainObject(
        customPermissions.invoices
      )
        ? customPermissions.invoices
        : {}),
    },

    payroll: {
      ...basePermissions.payroll,
      ...(isPlainObject(
        customPermissions.payroll
      )
        ? customPermissions.payroll
        : {}),
    },

    adminManagement:
      typeof customPermissions
        .adminManagement === "boolean"
        ? customPermissions
            .adminManagement
        : basePermissions
            .adminManagement,
  });
}

const DEFAULT_ADMIN_PERMISSIONS =
  deepFreeze({
    clients: {
      view: "none",
      edit: "none",
    },

    shifts: {
      view: "none",
      create: "none",
      edit: "none",
      assign: "none",
      cancel: "none",
    },

    staffPortalAccess: false,

    users: {
      view: false,
      manage: false,
    },

    staffApplications: {
      view: false,
      manage: false,
    },

    timesheets: {
      view: "none",
      approve: "none",
    },

    invoices: {
      view: "none",
      manage: "none",
    },

    payroll: {
      view: false,
      manage: false,
    },

    adminManagement: false,
  });

const SUPER_ADMIN_PERMISSIONS =
  deepFreeze({
    clients: {
      view: "all",
      edit: "all",
    },

    shifts: {
      view: "all",
      create: "all",
      edit: "all",
      assign: "all",
      cancel: "all",
    },

    staffPortalAccess: true,

    users: {
      view: true,
      manage: true,
    },

    staffApplications: {
      view: true,
      manage: true,
    },

    timesheets: {
      view: "all",
      approve: "all",
    },

    invoices: {
      view: "all",
      manage: "all",
    },

    payroll: {
      view: true,
      manage: true,
    },

    adminManagement: true,
  });

const ADMIN_PRESETS = deepFreeze({
  super_admin: {
    label: "Super Admin",

    permissions:
      SUPER_ADMIN_PERMISSIONS,
  },

  operations_admin: {
    label: "Operations Admin",

    permissions: mergePermissions(
      SUPER_ADMIN_PERMISSIONS,
      {
        adminManagement: false,
      }
    ),
  },

  all_client_viewer: {
    label:
      "View Only – All Clients",

    permissions: mergePermissions(
      DEFAULT_ADMIN_PERMISSIONS,
      {
        clients: {
          view: "all",
          edit: "none",
        },

        shifts: {
          view: "all",
        },
      }
    ),
  },

  assigned_client_viewer: {
    label:
      "View Only – Assigned Clients",

    permissions: mergePermissions(
      DEFAULT_ADMIN_PERMISSIONS,
      {
        clients: {
          view: "assigned",
          edit: "none",
        },

        shifts: {
          view: "assigned",
        },
      }
    ),
  },

  assigned_client_manager: {
    label:
      "Assigned Client Manager",

    permissions: mergePermissions(
      DEFAULT_ADMIN_PERMISSIONS,
      {
        clients: {
          view: "assigned",
          edit: "assigned",
        },

        shifts: {
          view: "assigned",
          create: "assigned",
          edit: "assigned",
          assign: "assigned",
          cancel: "assigned",
        },

        staffPortalAccess: true,

        users: {
          view: true,
          manage: false,
        },

        timesheets: {
          view: "assigned",
          approve: "assigned",
        },

        invoices: {
          view: "assigned",
          manage: "assigned",
        },
      }
    ),
  },

  shift_creator_all: {
    label:
      "Shift Creator – All Clients",

    permissions: mergePermissions(
      DEFAULT_ADMIN_PERMISSIONS,
      {
        clients: {
          view: "all",
          edit: "none",
        },

        shifts: {
          view: "all",
          create: "all",
        },
      }
    ),
  },

  shift_creator_assigned: {
    label:
      "Shift Creator – Assigned Clients",

    permissions: mergePermissions(
      DEFAULT_ADMIN_PERMISSIONS,
      {
        clients: {
          view: "assigned",
          edit: "none",
        },

        shifts: {
          view: "assigned",
          create: "assigned",
        },
      }
    ),
  },

  staff_portal_only: {
    label: "Staff Portal Access",

    permissions: mergePermissions(
      DEFAULT_ADMIN_PERMISSIONS,
      {
        staffPortalAccess: true,
      }
    ),
  },

  custom: {
    label: "Custom Access",

    permissions:
      DEFAULT_ADMIN_PERMISSIONS,
  },
});

const PROTECTED_SUPER_ADMIN_EMAILS =
  deepFreeze([
    "info@unityhealthcarestaffing.co.uk",
    "valentine@unityhealthcarestaffing.co.uk",
    "valentine.c.enyi@gmail.com",
  ]);

const protectedEmailSet = new Set(
  PROTECTED_SUPER_ADMIN_EMAILS
);

const ASSIGNABLE_PRESET_VALUES =
  deepFreeze([
    "operations_admin",
    "all_client_viewer",
    "assigned_client_viewer",
    "assigned_client_manager",
    "shift_creator_all",
    "shift_creator_assigned",
    "staff_portal_only",
    "custom",
  ]);

const assignablePresetSet =
  new Set(
    ASSIGNABLE_PRESET_VALUES
  );

function isProtectedSuperAdminEmail(
  email
) {
  return protectedEmailSet.has(
    normaliseEmail(email)
  );
}

function deniedAccess(reason) {
  return {
    isAdmin: false,
    isSuperAdmin: false,
    active: false,
    preset: null,
    assignedClientIds: [],
    permissions: clonePermissions(
      DEFAULT_ADMIN_PERMISSIONS
    ),
    reason,
  };
}

function profileIsDisabled(profile) {
  if (profile?.isActive === false) {
    return true;
  }

  const status = normaliseText(
    profile?.status ||
      profile?.accountStatus
  ).toLowerCase();

  return [
    "disabled",
    "inactive",
    "suspended",
  ].includes(status);
}

function resolveBackendAdminAccess(
  authContext,
  profile
) {
  if (!authContext?.uid) {
    return deniedAccess(
      "unauthenticated"
    );
  }

  if (
    authContext.token
      ?.email_verified !== true
  ) {
    return deniedAccess(
      "email-not-verified"
    );
  }

  const email = normaliseEmail(
    authContext.token?.email
  );

  if (
    isProtectedSuperAdminEmail(email)
  ) {
    return {
      isAdmin: true,
      isSuperAdmin: true,
      active: true,
      preset: "super_admin",
      assignedClientIds: [],
      permissions: clonePermissions(
        SUPER_ADMIN_PERMISSIONS
      ),
      reason: null,
    };
  }

  if (!isPlainObject(profile)) {
    return deniedAccess(
      "profile-not-found"
    );
  }

  if (profileIsDisabled(profile)) {
    return deniedAccess(
      "profile-disabled"
    );
  }

  const adminAccess =
    isPlainObject(
      profile.adminAccess
    )
      ? profile.adminAccess
      : {};

  const role = normaliseText(
    profile.role
  ).toLowerCase();

  const accountType = normaliseText(
    profile.accountType
  ).toLowerCase();

  const identitySaysAdmin =
    role === "admin" ||
    accountType === "admin" ||
    profile.isAdmin === true;

  const preset = normaliseText(
    adminAccess.preset
  ).toLowerCase();

  const hasStructuredAccess =
    Number(
      adminAccess.version || 0
    ) >= 1 &&
    assignablePresetSet.has(
      preset
    );

  if (
    !identitySaysAdmin ||
    !hasStructuredAccess
  ) {
    return deniedAccess(
      "structured-admin-access-required"
    );
  }

  if (
    adminAccess.enabled !== true ||
    adminAccess.active !== true
  ) {
    return deniedAccess(
      "admin-access-disabled"
    );
  }

  let permissions;

  if (preset === "custom") {
    permissions = mergePermissions(
      DEFAULT_ADMIN_PERMISSIONS,
      adminAccess.permissions
    );
  } else {
    permissions = clonePermissions(
      ADMIN_PRESETS[preset]
        .permissions
    );
  }

  /*
   * Only the three protected addresses
   * may manage administrator access.
   */
  permissions.adminManagement =
    false;

  return {
    isAdmin: true,
    isSuperAdmin: false,
    active: true,
    preset,
    assignedClientIds:
      cleanClientIds(
        adminAccess
          .assignedClientIds
      ),
    permissions,
    reason: null,
  };
}

function getPermissionValue(
  access,
  section,
  action
) {
  if (!access?.isAdmin) {
    return undefined;
  }

  const sectionValue =
    access.permissions?.[section];

  if (
    action === undefined ||
    action === null
  ) {
    return sectionValue;
  }

  if (
    !isPlainObject(sectionValue)
  ) {
    return undefined;
  }

  return sectionValue[action];
}

function canUseBooleanPermission(
  access,
  section,
  action
) {
  return (
    getPermissionValue(
      access,
      section,
      action
    ) === true
  );
}

function canUseScopedPermission(
  access,
  section,
  action,
  clientId
) {
  if (!access?.isAdmin) {
    return false;
  }

  const scope = getPermissionValue(
    access,
    section,
    action
  );

  if (scope === ACCESS_SCOPES.ALL) {
    return true;
  }

  if (
    scope !==
    ACCESS_SCOPES.ASSIGNED
  ) {
    return false;
  }

  const cleanClientId =
    normaliseText(clientId);

  return (
    Boolean(cleanClientId) &&
    access.assignedClientIds
      .includes(cleanClientId)
  );
}

function createCallableAdminAuthorizer({
  admin,
  HttpsError,
}) {
  if (!admin || !HttpsError) {
    throw new Error(
      "admin and HttpsError are required."
    );
  }

  function deniedMessage(reason) {
    switch (reason) {
      case "email-not-verified":
        return (
          "A verified administrator email is required."
        );

      case "admin-access-disabled":
        return (
          "Administrator access is disabled."
        );

      case "profile-disabled":
        return (
          "The administrator profile is disabled."
        );

      case "profile-not-found":
        return (
          "The administrator profile could not be found."
        );

      default:
        return (
          "Structured administrator access is required."
        );
    }
  }

  async function load(request) {
    if (!request?.auth?.uid) {
      throw new HttpsError(
        "unauthenticated",
        "You must be logged in."
      );
    }

    const email = normaliseEmail(
      request.auth.token?.email
    );

    let profile = null;

    /*
     * Protected Super Admins do not depend
     * on a Firestore profile document.
     */
    if (
      !isProtectedSuperAdminEmail(email)
    ) {
      const profileSnapshot =
        await admin
          .firestore()
          .collection("users")
          .doc(request.auth.uid)
          .get();

      profile = profileSnapshot.exists
        ? profileSnapshot.data() || {}
        : null;
    }

    const access =
      resolveBackendAdminAccess(
        request.auth,
        profile
      );

    if (!access.isAdmin) {
      throw new HttpsError(
        "permission-denied",
        deniedMessage(access.reason)
      );
    }

    return access;
  }

  function assertProtected(
    access
  ) {
    if (!access?.isSuperAdmin) {
      throw new HttpsError(
        "permission-denied",
        "Protected Super Admin access is required."
      );
    }

    return access;
  }

  function assertScoped(
    access,
    section,
    action,
    clientId
  ) {
    if (
      !canUseScopedPermission(
        access,
        section,
        action,
        clientId
      )
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to perform this action for the selected client."
      );
    }

    return access;
  }

  function assertBoolean(
    access,
    section,
    action
  ) {
    if (
      !canUseBooleanPermission(
        access,
        section,
        action
      )
    ) {
      throw new HttpsError(
        "permission-denied",
        "You do not have permission to perform this action."
      );
    }

    return access;
  }

  async function requireProtected(
    request
  ) {
    const access = await load(request);
    return assertProtected(access);
  }

  async function requireScoped(
    request,
    section,
    action,
    clientId
  ) {
    const access = await load(request);

    return assertScoped(
      access,
      section,
      action,
      clientId
    );
  }

  async function requireBoolean(
    request,
    section,
    action
  ) {
    const access = await load(request);

    return assertBoolean(
      access,
      section,
      action
    );
  }

  return Object.freeze({
    assertBoolean,
    assertProtected,
    assertScoped,
    load,
    requireBoolean,
    requireProtected,
    requireScoped,
  });
}
module.exports = {
  ACCESS_SCOPES,
  ADMIN_PRESETS,
  ASSIGNABLE_PRESET_VALUES,
  DEFAULT_ADMIN_PERMISSIONS,
  PROTECTED_SUPER_ADMIN_EMAILS,
  SUPER_ADMIN_PERMISSIONS,
  canUseBooleanPermission,
  canUseScopedPermission,
  createCallableAdminAuthorizer,
  cleanClientIds,
  clonePermissions,
  getPermissionValue,
  isProtectedSuperAdminEmail,
  mergePermissions,
  normaliseEmail,
  normaliseScope,
  resolveBackendAdminAccess,
};