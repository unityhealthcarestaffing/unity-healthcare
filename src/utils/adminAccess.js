export const SUPER_ADMIN_EMAILS = [
  "info@unityhealthcarestaffing.co.uk",
  "valentine@unityhealthcarestaffing.co.uk",
  "valentine.c.enyi@gmail.com",
];

export const ACCESS_SCOPES = {
  NONE: "none",
  ASSIGNED: "assigned",
  ALL: "all",
};

export const DEFAULT_ADMIN_PERMISSIONS = {
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
};

export const SUPER_ADMIN_PERMISSIONS = {
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
};

export const ADMIN_PRESETS = {
  super_admin: {
    label: "Super Admin",
    permissions: SUPER_ADMIN_PERMISSIONS,
  },

  operations_admin: {
    label: "Operations Admin",
    permissions: {
      ...SUPER_ADMIN_PERMISSIONS,
      adminManagement: false,
    },
  },

  all_client_viewer: {
    label: "View Only – All Clients",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,

      clients: {
        view: "all",
        edit: "none",
      },

      shifts: {
        ...DEFAULT_ADMIN_PERMISSIONS.shifts,
        view: "all",
      },
    },
  },

  assigned_client_viewer: {
    label: "View Only – Assigned Clients",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,

      clients: {
        view: "assigned",
        edit: "none",
      },

      shifts: {
        ...DEFAULT_ADMIN_PERMISSIONS.shifts,
        view: "assigned",
      },
    },
  },

  assigned_client_manager: {
    label: "Assigned Client Manager",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,

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
    },
  },

  shift_creator_all: {
    label: "Shift Creator – All Clients",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,

      clients: {
        view: "all",
        edit: "none",
      },

      shifts: {
        ...DEFAULT_ADMIN_PERMISSIONS.shifts,
        view: "all",
        create: "all",
      },
    },
  },

  shift_creator_assigned: {
    label: "Shift Creator – Assigned Clients",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,

      clients: {
        view: "assigned",
        edit: "none",
      },

      shifts: {
        ...DEFAULT_ADMIN_PERMISSIONS.shifts,
        view: "assigned",
        create: "assigned",
      },
    },
  },

  staff_portal_only: {
    label: "Staff Portal Access",
    permissions: {
      ...DEFAULT_ADMIN_PERMISSIONS,
      staffPortalAccess: true,
    },
  },

  custom: {
    label: "Custom Access",
    permissions: DEFAULT_ADMIN_PERMISSIONS,
  },
};

function cleanEmail(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function cleanClientIds(values) {
  if (!Array.isArray(values)) return [];

  return [
    ...new Set(
      values
        .map((value) =>
          String(value || "").trim()
        )
        .filter(Boolean)
    ),
  ];
}

function mergePermissions(base, custom = {}) {
  return {
    clients: {
      ...base.clients,
      ...(custom.clients || {}),
    },

    shifts: {
      ...base.shifts,
      ...(custom.shifts || {}),
    },

    staffPortalAccess:
      custom.staffPortalAccess ??
      base.staffPortalAccess,

    users: {
      ...base.users,
      ...(custom.users || {}),
    },

    staffApplications: {
      ...base.staffApplications,
      ...(custom.staffApplications || {}),
    },

    timesheets: {
      ...base.timesheets,
      ...(custom.timesheets || {}),
    },

    invoices: {
      ...base.invoices,
      ...(custom.invoices || {}),
    },

    payroll: {
      ...base.payroll,
      ...(custom.payroll || {}),
    },

    adminManagement:
      custom.adminManagement ??
      base.adminManagement,
  };
}

export function resolveAdminAccess(
  user,
  profile
) {
  const email = cleanEmail(user?.email);

  const verified =
    user?.emailVerified === true;

  const noAccess = () => ({
    isAdmin: false,
    isSuperAdmin: false,
    active: false,
    preset: null,
    assignedClientIds: [],
    permissions: mergePermissions(
      DEFAULT_ADMIN_PERMISSIONS
    ),
  });

  if (
    verified &&
    SUPER_ADMIN_EMAILS.includes(email)
  ) {
    return {
      isAdmin: true,
      isSuperAdmin: true,
      active: true,
      preset: "super_admin",
      assignedClientIds: [],
      permissions: mergePermissions(
        SUPER_ADMIN_PERMISSIONS
      ),
    };
  }

  if (!verified) {
    return noAccess();
  }

  const adminAccess =
    profile?.adminAccess &&
    typeof profile.adminAccess === "object"
      ? profile.adminAccess
      : {};

  const role = String(
    profile?.role ||
      profile?.accountType ||
      ""
  )
    .trim()
    .toLowerCase();

  const profileSaysAdmin =
    role === "admin" ||
    profile?.isAdmin === true ||
    adminAccess.enabled === true;

  const disabled =
    adminAccess.enabled !== true ||
    adminAccess.active !== true ||
    profile?.isActive === false ||
    String(profile?.status || "")
      .trim()
      .toLowerCase() === "disabled";

  const presetKey = String(
    adminAccess.preset || ""
  ).trim();

  const preset =
    ADMIN_PRESETS[presetKey];

  const hasStructuredPermissions =
    Number(adminAccess.version || 0) >= 1 &&
    Boolean(preset) &&
    presetKey !== "super_admin";

  if (
    !profileSaysAdmin ||
    disabled ||
    !hasStructuredPermissions
  ) {
    return noAccess();
  }

  const permissions =
    presetKey === "custom"
      ? mergePermissions(
          preset.permissions,
          adminAccess.permissions || {}
        )
      : mergePermissions(
          preset.permissions
        );

  return {
    isAdmin: true,
    isSuperAdmin: false,
    active: true,
    preset: presetKey,
    assignedClientIds: cleanClientIds(
      adminAccess.assignedClientIds ||
        profile?.assignedClientIds ||
        []
    ),
    permissions,
  };
}

export function canAccessClient(
  adminAccess,
  clientId,
  permissionScope
) {
  if (
    adminAccess?.isSuperAdmin ||
    permissionScope === "all"
  ) {
    return true;
  }

  if (permissionScope !== "assigned") {
    return false;
  }

  const targetId = String(
    clientId || ""
  ).trim();

  return (
    Boolean(targetId) &&
    adminAccess.assignedClientIds.includes(
      targetId
    )
  );
}

export function canViewAdminTab(
  adminAccess,
  tabId
) {
  if (!adminAccess?.isAdmin) return false;

  const p = adminAccess.permissions;

  switch (tabId) {
    case "admin-clients":
      return p.clients.view !== "none";

    case "admin-shifts":
      return [
        p.shifts.view,
        p.shifts.create,
        p.shifts.edit,
        p.shifts.assign,
        p.shifts.cancel,
      ].some((scope) => scope !== "none");

    case "admin-users":
      return (
        p.users.view === true ||
        p.users.manage === true
      );

    case "admin-timesheets":
      return p.timesheets.view !== "none";

    case "admin-invoices":
      return p.invoices.view !== "none";

    case "payroll":
      return p.payroll.view === true;

    case "admin-staff-applications":
      return (
        p.staffApplications.view === true
      );

    case "admin-access":
      return p.adminManagement === true;

    default:
      return false;
  }
}
