"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  pathToFileURL,
} = require("node:url");

const {
  ADMIN_PRESETS,
  ASSIGNABLE_PRESET_VALUES,
  DEFAULT_ADMIN_PERMISSIONS,
  PROTECTED_SUPER_ADMIN_EMAILS,
  SUPER_ADMIN_PERMISSIONS,
  canUseBooleanPermission,
  canUseScopedPermission,
  cleanClientIds,
  resolveBackendAdminAccess,
} = require("../adminAuthorization");

function makeAuth({
  uid = "admin-user",
  email = "admin@example.com",
  verified = true,
} = {}) {
  return {
    uid,
    token: {
      email,
      email_verified: verified,
    },
  };
}

function makeStructuredProfile({
  preset = "operations_admin",
  enabled = true,
  active = true,
  assignedClientIds = [],
  permissions = {},
  overrides = {},
} = {}) {
  return {
    role: "admin",
    accountType: "admin",
    isAdmin: true,

    adminAccess: {
      version: 1,
      enabled,
      active,
      preset,
      assignedClientIds,
      permissions,
    },

    ...overrides,
  };
}

test(
  "backend permission definitions exactly match the frontend model",
  async () => {
    const frontendModuleUrl =
      pathToFileURL(
        path.resolve(
          __dirname,
          "../../src/utils/adminAccess.js"
        )
      ).href;

    const frontend =
      await import(
        frontendModuleUrl
      );

    assert.deepEqual(
      DEFAULT_ADMIN_PERMISSIONS,
      frontend
        .DEFAULT_ADMIN_PERMISSIONS
    );

    assert.deepEqual(
      SUPER_ADMIN_PERMISSIONS,
      frontend
        .SUPER_ADMIN_PERMISSIONS
    );

    assert.deepEqual(
      ADMIN_PRESETS,
      frontend.ADMIN_PRESETS
    );
  }
);

test(
  "all three protected emails resolve as unrestricted Super Admins",
  () => {
    assert.equal(
      PROTECTED_SUPER_ADMIN_EMAILS
        .length,
      3
    );

    for (
      const email of
      PROTECTED_SUPER_ADMIN_EMAILS
    ) {
      const access =
        resolveBackendAdminAccess(
          makeAuth({
            email:
              ` ${email.toUpperCase()} `,
          }),
          null
        );

      assert.equal(
        access.isSuperAdmin,
        true
      );

      assert.equal(
        access.permissions
          .adminManagement,
        true
      );
    }
  }
);

test(
  "unauthenticated requests are denied",
  () => {
    const access =
      resolveBackendAdminAccess(
        null,
        null
      );

    assert.equal(
      access.isAdmin,
      false
    );

    assert.equal(
      access.reason,
      "unauthenticated"
    );
  }
);

test(
  "unverified email accounts are denied",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth({
          email:
            PROTECTED_SUPER_ADMIN_EMAILS[0],
          verified: false,
        }),
        null
      );

    assert.equal(
      access.isAdmin,
      false
    );

    assert.equal(
      access.reason,
      "email-not-verified"
    );
  }
);

test(
  "legacy role-only administrator profiles are not trusted by the backend",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        {
          role: "admin",
          accountType: "admin",
          isAdmin: true,
        }
      );

    assert.equal(
      access.isAdmin,
      false
    );

    assert.equal(
      access.reason,
      "structured-admin-access-required"
    );
  }
);

test(
  "operations administrator receives full operational access",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile()
      );

    assert.equal(
      access.isAdmin,
      true
    );

    assert.equal(
      canUseScopedPermission(
        access,
        "shifts",
        "create",
        "any-client"
      ),
      true
    );

    assert.equal(
      canUseBooleanPermission(
        access,
        "users",
        "manage"
      ),
      true
    );

    assert.equal(
      access.permissions
        .adminManagement,
      false
    );
  }
);

test(
  "standard presets ignore stored permission escalation attempts",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset:
            "shift_creator_all",

          permissions: {
            adminManagement: true,

            shifts: {
              assign: "all",
              cancel: "all",
            },
          },
        })
      );

    assert.equal(
      access.permissions
        .adminManagement,
      false
    );

    assert.equal(
      access.permissions.shifts
        .assign,
      "none"
    );

    assert.equal(
      access.permissions.shifts
        .cancel,
      "none"
    );
  }
);

test(
  "assigned-client permission allows a listed client",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset:
            "assigned_client_manager",

          assignedClientIds: [
            "client-a",
          ],
        })
      );

    assert.equal(
      canUseScopedPermission(
        access,
        "shifts",
        "assign",
        "client-a"
      ),
      true
    );
  }
);

test(
  "assigned-client permission rejects an unlisted client",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset:
            "assigned_client_manager",

          assignedClientIds: [
            "client-a",
          ],
        })
      );

    assert.equal(
      canUseScopedPermission(
        access,
        "shifts",
        "assign",
        "client-b"
      ),
      false
    );
  }
);

test(
  "all-client scope permits any valid client identifier",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset:
            "shift_creator_all",
        })
      );

    assert.equal(
      canUseScopedPermission(
        access,
        "shifts",
        "create",
        "client-z"
      ),
      true
    );
  }
);

test(
  "none scope denies the operation",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset:
            "all_client_viewer",
        })
      );

    assert.equal(
      canUseScopedPermission(
        access,
        "shifts",
        "create",
        "client-a"
      ),
      false
    );
  }
);

test(
  "boolean user-management permission is resolved correctly",
  () => {
    const operationsAccess =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile()
      );

    const viewerAccess =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset:
            "all_client_viewer",
        })
      );

    assert.equal(
      canUseBooleanPermission(
        operationsAccess,
        "users",
        "manage"
      ),
      true
    );

    assert.equal(
      canUseBooleanPermission(
        viewerAccess,
        "users",
        "manage"
      ),
      false
    );
  }
);

test(
  "custom access is safely normalised and cannot grant admin management",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset: "custom",

          assignedClientIds: [
            "client-a",
          ],

          permissions: {
            clients: {
              view: "assigned",
            },

            users: {
              view: true,
            },

            adminManagement: true,
          },
        })
      );

    assert.equal(
      canUseScopedPermission(
        access,
        "clients",
        "view",
        "client-a"
      ),
      true
    );

    assert.equal(
      canUseBooleanPermission(
        access,
        "users",
        "view"
      ),
      true
    );

    assert.equal(
      access.permissions
        .adminManagement,
      false
    );
  }
);

test(
  "invalid custom permission scopes safely become none",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset: "custom",

          permissions: {
            shifts: {
              create: "owner",
            },
          },
        })
      );

    assert.equal(
      access.permissions.shifts
        .create,
      "none"
    );

    assert.equal(
      canUseScopedPermission(
        access,
        "shifts",
        "create",
        "client-a"
      ),
      false
    );
  }
);

test(
  "inactive structured administrator access is denied",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          active: false,
        })
      );

    assert.equal(
      access.isAdmin,
      false
    );

    assert.equal(
      access.reason,
      "admin-access-disabled"
    );
  }
);

test(
  "disabled user profiles are denied",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          overrides: {
            status: "disabled",
          },
        })
      );

    assert.equal(
      access.isAdmin,
      false
    );

    assert.equal(
      access.reason,
      "profile-disabled"
    );
  }
);

test(
  "staff-portal-only preset grants no operational administrator permissions",
  () => {
    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset:
            "staff_portal_only",
        })
      );

    assert.equal(
      canUseBooleanPermission(
        access,
        "staffPortalAccess"
      ),
      true
    );

    assert.equal(
      canUseScopedPermission(
        access,
        "shifts",
        "view",
        "client-a"
      ),
      false
    );
  }
);

test(
  "assigned client identifiers are cleaned and deduplicated",
  () => {
    assert.deepEqual(
      cleanClientIds([
        "client-a",
        " client-a ",
        "client-b",
        "",
        "clients/client-c",
      ]),
      [
        "client-a",
        "client-b",
      ]
    );

    const access =
      resolveBackendAdminAccess(
        makeAuth(),
        makeStructuredProfile({
          preset:
            "assigned_client_viewer",

          assignedClientIds: [
            "client-a",
            " client-a ",
          ],
        })
      );

    assert.deepEqual(
      access.assignedClientIds,
      ["client-a"]
    );
  }
);

test(
  "Super Admin cannot be assigned as an ordinary preset",
  () => {
    assert.equal(
      ASSIGNABLE_PRESET_VALUES
        .includes("super_admin"),
      false
    );
  }
);