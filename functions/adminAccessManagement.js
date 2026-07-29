"use strict";

const PROTECTED_SUPER_ADMIN_EMAILS = Object.freeze([
  "info@unityhealthcarestaffing.co.uk",
  "valentine@unityhealthcarestaffing.co.uk",
  "valentine.c.enyi@gmail.com",
]);

const protectedEmailSet = new Set(
  PROTECTED_SUPER_ADMIN_EMAILS
);

const ACCESS_SCOPES = Object.freeze([
  "none",
  "assigned",
  "all",
]);

const accessScopeSet = new Set(ACCESS_SCOPES);

const ASSIGNABLE_PRESET_VALUES = Object.freeze([
  "operations_admin",
  "all_client_viewer",
  "assigned_client_viewer",
  "assigned_client_manager",
  "shift_creator_all",
  "shift_creator_assigned",
  "staff_portal_only",
  "custom",
]);

const assignablePresetSet = new Set(
  ASSIGNABLE_PRESET_VALUES
);

const ASSIGNMENT_PRESET_VALUES = Object.freeze([
  "assigned_client_viewer",
  "assigned_client_manager",
  "shift_creator_assigned",
]);

const assignmentPresetSet = new Set(
  ASSIGNMENT_PRESET_VALUES
);

const REQUEST_KEYS = Object.freeze([
  "action",
  "targetUid",
  "enabled",
  "active",
  "preset",
  "assignedClientIds",
  "permissions",
]);

const DISABLE_REQUEST_KEYS = Object.freeze([
  "action",
  "targetUid",
]);

const CUSTOM_PERMISSION_KEYS = Object.freeze([
  "clients",
  "shifts",
  "staffPortalAccess",
  "users",
  "staffApplications",
  "timesheets",
  "invoices",
  "payroll",
  "adminManagement",
]);

class AdminAccessValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AdminAccessValidationError";
  }
}

function validationError(message) {
  return new AdminAccessValidationError(message);
}

function normalizeText(value) {
  return String(value ?? "").trim();
}

function normalizeEmail(value) {
  return normalizeText(value).toLowerCase();
}

function isProtectedSuperAdminEmail(email) {
  return protectedEmailSet.has(
    normalizeEmail(email)
  );
}

function isPlainObject(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  );
}

function requirePlainObject(
  value,
  label,
  allowUndefined = false
) {
  if (
    allowUndefined &&
    (value === undefined || value === null)
  ) {
    return {};
  }

  if (!isPlainObject(value)) {
    throw validationError(
      `${label} must be an object.`
    );
  }

  return value;
}

function assertNoUnknownKeys(
  source,
  allowedKeys,
  label
) {
  const allowed = new Set(allowedKeys);

  const unknownKeys = Object.keys(source)
    .filter((key) => !allowed.has(key));

  if (unknownKeys.length > 0) {
    throw validationError(
      `${label} contains unsupported field${
        unknownKeys.length === 1 ? "" : "s"
      }: ${unknownKeys.join(", ")}.`
    );
  }
}

function requireBoolean(value, label) {
  if (typeof value !== "boolean") {
    throw validationError(
      `${label} must be true or false.`
    );
  }

  return value;
}

function optionalBoolean(
  source,
  key,
  defaultValue,
  label
) {
  if (!(key in source)) {
    return defaultValue;
  }

  return requireBoolean(
    source[key],
    label
  );
}

function optionalScope(
  source,
  key,
  defaultValue,
  label
) {
  if (!(key in source)) {
    return defaultValue;
  }

  const value = normalizeText(
    source[key]
  ).toLowerCase();

  if (!accessScopeSet.has(value)) {
    throw validationError(
      `${label} must be none, assigned or all.`
    );
  }

  return value;
}

function sanitizeScopeSection(
  value,
  allowedKeys,
  label
) {
  const source = requirePlainObject(
    value,
    label,
    true
  );

  assertNoUnknownKeys(
    source,
    allowedKeys,
    label
  );

  return Object.fromEntries(
    allowedKeys.map((key) => [
      key,
      optionalScope(
        source,
        key,
        "none",
        `${label}.${key}`
      ),
    ])
  );
}

function sanitizeBooleanSection(
  value,
  allowedKeys,
  label
) {
  const source = requirePlainObject(
    value,
    label,
    true
  );

  assertNoUnknownKeys(
    source,
    allowedKeys,
    label
  );

  return Object.fromEntries(
    allowedKeys.map((key) => [
      key,
      optionalBoolean(
        source,
        key,
        false,
        `${label}.${key}`
      ),
    ])
  );
}

function sanitizeCustomPermissions(value) {
  const source = requirePlainObject(
    value,
    "permissions",
    true
  );

  assertNoUnknownKeys(
    source,
    CUSTOM_PERMISSION_KEYS,
    "permissions"
  );

  if (
    "adminManagement" in source &&
    source.adminManagement !== false
  ) {
    throw validationError(
      "Custom access cannot grant administrator-access management."
    );
  }

  return {
    clients: sanitizeScopeSection(
      source.clients,
      ["view", "edit"],
      "permissions.clients"
    ),

    shifts: sanitizeScopeSection(
      source.shifts,
      [
        "view",
        "create",
        "edit",
        "assign",
        "cancel",
      ],
      "permissions.shifts"
    ),

    staffPortalAccess: optionalBoolean(
      source,
      "staffPortalAccess",
      false,
      "permissions.staffPortalAccess"
    ),

    users: sanitizeBooleanSection(
      source.users,
      ["view", "manage"],
      "permissions.users"
    ),

    staffApplications:
      sanitizeBooleanSection(
        source.staffApplications,
        ["view", "manage"],
        "permissions.staffApplications"
      ),

    timesheets: sanitizeScopeSection(
      source.timesheets,
      ["view", "approve"],
      "permissions.timesheets"
    ),

    invoices: sanitizeScopeSection(
      source.invoices,
      ["view", "manage"],
      "permissions.invoices"
    ),

    payroll: sanitizeBooleanSection(
      source.payroll,
      ["view", "manage"],
      "permissions.payroll"
    ),

    adminManagement: false,
  };
}

function customPermissionsUseAssignedScope(
  permissions
) {
  const scopeSections = [
    permissions?.clients,
    permissions?.shifts,
    permissions?.timesheets,
    permissions?.invoices,
  ];

  return scopeSections.some(
    (section) =>
      isPlainObject(section) &&
      Object.values(section).includes(
        "assigned"
      )
  );
}

function validateDocumentId(
  value,
  label,
  maximumLength
) {
  if (typeof value !== "string") {
    throw validationError(
      `${label} must be a string.`
    );
  }

  const result = value.trim();

  if (!result) {
    throw validationError(
      `${label} is required.`
    );
  }

  if (
    result.length > maximumLength ||
    result.includes("/")
  ) {
    throw validationError(
      `${label} is invalid.`
    );
  }

  return result;
}

function sanitizeAssignedClientIds(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw validationError(
      "assignedClientIds must be an array."
    );
  }

  if (value.length > 200) {
    throw validationError(
      "No more than 200 assigned clients may be submitted."
    );
  }

  const cleaned = value.map(
    (clientId, index) =>
      validateDocumentId(
        clientId,
        `assignedClientIds[${index}]`,
        256
      )
  );

  return [...new Set(cleaned)];
}

function ensureEmptyPresetPermissions(value) {
  if (
    value === undefined ||
    value === null
  ) {
    return;
  }

  if (
    !isPlainObject(value) ||
    Object.keys(value).length !== 0
  ) {
    throw validationError(
      "Standard preset permissions are generated by the server and must not be supplied."
    );
  }
}

function buildAccessConfiguration(data) {
  const source = requirePlainObject(
    data,
    "Request data"
  );

  const preset = normalizeText(
    source.preset
  ).toLowerCase();

  if (!assignablePresetSet.has(preset)) {
    throw validationError(
      "The selected administrator-access preset is invalid."
    );
  }

  const enabled = requireBoolean(
    source.enabled,
    "enabled"
  );

  const activeInput = requireBoolean(
    source.active,
    "active"
  );

  let assignedClientIds =
    sanitizeAssignedClientIds(
      source.assignedClientIds
    );

  let permissions = {};
  let requiresAssignedClients =
    assignmentPresetSet.has(preset);

  if (preset === "custom") {
    permissions =
      sanitizeCustomPermissions(
        source.permissions
      );

    requiresAssignedClients =
      customPermissionsUseAssignedScope(
        permissions
      );

    if (!requiresAssignedClients) {
      assignedClientIds = [];
    }
  } else {
    ensureEmptyPresetPermissions(
      source.permissions
    );

    if (!requiresAssignedClients) {
      assignedClientIds = [];
    }
  }

  if (
    enabled &&
    requiresAssignedClients &&
    assignedClientIds.length === 0
  ) {
    throw validationError(
      "At least one assigned client is required for this access configuration."
    );
  }

  return {
    enabled,
    active: enabled && activeInput,
    preset,
    assignedClientIds,
    permissions,
    requiresAssignedClients,
  };
}

async function assertAssignedClientsExist(
  db,
  clientIds,
  HttpsError
) {
  if (clientIds.length === 0) {
    return;
  }

  const references = clientIds.map(
    (clientId) =>
      db.collection("clients").doc(clientId)
  );

  const snapshots = await db.getAll(
    ...references
  );

  const missingClientIds = snapshots
    .filter((snapshot) => !snapshot.exists)
    .map((snapshot) => snapshot.id);

  if (missingClientIds.length > 0) {
    throw new HttpsError(
      "failed-precondition",
      `Assigned client record${
        missingClientIds.length === 1
          ? ""
          : "s"
      } not found: ${missingClientIds.join(", ")}.`
    );
  }
}

async function readTargetAuthUser(
  admin,
  targetUid,
  HttpsError
) {
  try {
    return await admin
      .auth()
      .getUser(targetUid);
  } catch (error) {
    if (
      error?.code === "auth/user-not-found"
    ) {
      throw new HttpsError(
        "not-found",
        "The selected user does not have a Firebase Authentication account."
      );
    }

    throw error;
  }
}

function createManageAdminAccessHandler({
  admin,
  HttpsError,
  serverTimestamp,
}) {
  if (!admin || !HttpsError) {
    throw new Error(
      "admin and HttpsError are required."
    );
  }

  const createServerTimestamp =
    typeof serverTimestamp === "function"
      ? serverTimestamp
      : typeof admin.firestore
          ?.FieldValue
          ?.serverTimestamp === "function"
        ? () =>
            admin.firestore
              .FieldValue
              .serverTimestamp()
        : null;

  if (
    typeof createServerTimestamp !==
    "function"
  ) {
    throw new Error(
      "serverTimestamp is required."
    );
  }

  return async function manageAdminAccess(
    request
  ) {
    try {
      if (!request.auth?.uid) {
        throw new HttpsError(
          "unauthenticated",
          "You must be logged in."
        );
      }

      const callerUid = normalizeText(
        request.auth.uid
      );

      const callerEmail = normalizeEmail(
        request.auth.token?.email
      );

      if (
        !isProtectedSuperAdminEmail(
          callerEmail
        )
      ) {
        throw new HttpsError(
          "permission-denied",
          "Protected Super Admin access is required."
        );
      }

      if (
        request.auth.token
          ?.email_verified !== true
      ) {
        throw new HttpsError(
          "permission-denied",
          "The protected Super Admin email must be verified."
        );
      }

      const data = requirePlainObject(
        request.data,
        "Request data"
      );

      const action = normalizeText(
        data.action
      ).toLowerCase();

      if (
        action !== "save" &&
        action !== "disable"
      ) {
        throw validationError(
          "action must be save or disable."
        );
      }

      assertNoUnknownKeys(
        data,
        action === "disable"
          ? DISABLE_REQUEST_KEYS
          : REQUEST_KEYS,
        "Request data"
      );

      const targetUid =
        validateDocumentId(
          data.targetUid,
          "targetUid",
          128
        );

      if (targetUid === callerUid) {
        throw new HttpsError(
          "permission-denied",
          "Protected Super Admin accounts cannot be changed."
        );
      }

      const db = admin.firestore();
      const targetReference =
        db.collection("users").doc(
          targetUid
        );

      const [
        targetSnapshot,
        targetAuthUser,
      ] = await Promise.all([
        targetReference.get(),
        readTargetAuthUser(
          admin,
          targetUid,
          HttpsError
        ),
      ]);

      if (!targetSnapshot.exists) {
        throw new HttpsError(
          "not-found",
          "The selected user profile was not found."
        );
      }

      const targetData =
        targetSnapshot.data() || {};

      const targetEmails = [
        targetData.email,
        targetData.emailAddress,
        targetAuthUser.email,
      ]
        .map(normalizeEmail)
        .filter(Boolean);

      if (
        targetEmails.some(
          isProtectedSuperAdminEmail
        )
      ) {
        throw new HttpsError(
          "permission-denied",
          "Protected Super Admin accounts cannot be changed."
        );
      }

      const updatedAt =
        createServerTimestamp();

      const updatedBy =
        callerEmail || callerUid;

      if (action === "disable") {
        const storedPreset =
          normalizeText(
            targetData.adminAccess
              ?.preset
          ).toLowerCase();

        const safePreset =
          assignablePresetSet.has(
            storedPreset
          )
            ? storedPreset
            : "operations_admin";

        const disabledAccess = {
          version: 1,
          enabled: false,
          active: false,
          preset: safePreset,
          assignedClientIds: [],
          permissions: {},
          updatedAt,
          updatedBy,
          updatedByUid: callerUid,
        };

        await targetReference.update({
          adminAccess: disabledAccess,
          adminAccessUpdatedAt:
            updatedAt,
          adminAccessUpdatedBy:
            updatedBy,
        });

        console.log(
          "manageAdminAccessV2 disabled access",
          {
            actorUid: callerUid,
            actorEmail: callerEmail,
            targetUid,
          }
        );

        return {
          ok: true,
          action,
          targetUid,
          adminAccess: {
            enabled: false,
            active: false,
            preset: safePreset,
            assignedClientIds: [],
            permissions: {},
          },
          message:
            "Administrator access was disabled.",
        };
      }

      const access =
        buildAccessConfiguration(data);

      await assertAssignedClientsExist(
        db,
        access.assignedClientIds,
        HttpsError
      );

      const storedAccess = {
        version: 1,
        enabled: access.enabled,
        active: access.active,
        preset: access.preset,
        assignedClientIds:
          access.assignedClientIds,
        permissions:
          access.permissions,
        updatedAt,
        updatedBy,
        updatedByUid: callerUid,
      };

      await targetReference.update({
        role: "admin",
        accountType: "admin",
        isAdmin: true,
        adminAccess: storedAccess,
        adminAccessUpdatedAt:
          updatedAt,
        adminAccessUpdatedBy:
          updatedBy,
      });

      console.log(
        "manageAdminAccessV2 saved access",
        {
          actorUid: callerUid,
          actorEmail: callerEmail,
          targetUid,
          preset: access.preset,
          enabled: access.enabled,
          active: access.active,
          assignedClientCount:
            access.assignedClientIds
              .length,
        }
      );

      return {
        ok: true,
        action,
        targetUid,
        adminAccess: {
          enabled: access.enabled,
          active: access.active,
          preset: access.preset,
          assignedClientIds:
            access.assignedClientIds,
          permissions:
            access.permissions,
        },
        message:
          "Administrator access settings were saved.",
      };
    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }

      if (
        error instanceof
        AdminAccessValidationError
      ) {
        throw new HttpsError(
          "invalid-argument",
          error.message
        );
      }

      console.error(
        "manageAdminAccessV2 error:",
        error
      );

      throw new HttpsError(
        "internal",
        "Administrator access could not be updated."
      );
    }
  };
}

module.exports = {
  ACCESS_SCOPES,
  ASSIGNABLE_PRESET_VALUES,
  ASSIGNMENT_PRESET_VALUES,
  PROTECTED_SUPER_ADMIN_EMAILS,
  AdminAccessValidationError,
  buildAccessConfiguration,
  createManageAdminAccessHandler,
  customPermissionsUseAssignedScope,
  isProtectedSuperAdminEmail,
  normalizeEmail,
  sanitizeAssignedClientIds,
  sanitizeCustomPermissions,
};