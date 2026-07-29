import test from "node:test";
import assert from "node:assert/strict";

import {
  resolveAdminAccess,
} from "../src/utils/adminAccess.js";

function user({
  email = "administrator@example.test",
  verified = true,
} = {}) {
  return {
    email,
    emailVerified: verified,
  };
}

function structuredProfile({
  preset = "operations_admin",
  enabled = true,
  active = true,
  permissions = {},
  assignedClientIds = [],
  overrides = {},
} = {}) {
  return {
    role: "admin",
    accountType: "admin",
    isAdmin: true,
    isActive: true,
    status: "active",

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
  "verified protected email receives Super Admin access without a profile",
  () => {
    const access =
      resolveAdminAccess(
        user({
          email:
            "info@unityhealthcarestaffing.co.uk",
          verified: true,
        }),
        null
      );

    assert.equal(
      access.isAdmin,
      true
    );

    assert.equal(
      access.isSuperAdmin,
      true
    );

    assert.equal(
      access.preset,
      "super_admin"
    );
  }
);

test(
  "unverified protected email receives no administrator access",
  () => {
    const access =
      resolveAdminAccess(
        user({
          email:
            "info@unityhealthcarestaffing.co.uk",
          verified: false,
        }),
        null
      );

    assert.equal(
      access.isAdmin,
      false
    );

    assert.equal(
      access.isSuperAdmin,
      false
    );
  }
);

for (
  const legacyProfile of
  [
    {
      role: "admin",
    },
    {
      accountType: "admin",
    },
    {
      isAdmin: true,
    },
  ]
) {
  test(
    "legacy administrator markers do not grant frontend access",
    () => {
      const access =
        resolveAdminAccess(
          user(),
          legacyProfile
        );

      assert.equal(
        access.isAdmin,
        false
      );

      assert.equal(
        access.preset,
        null
      );
    }
  );
}

test(
  "verified structured Operations Admin receives access",
  () => {
    const access =
      resolveAdminAccess(
        user(),
        structuredProfile()
      );

    assert.equal(
      access.isAdmin,
      true
    );

    assert.equal(
      access.isSuperAdmin,
      false
    );

    assert.equal(
      access.preset,
      "operations_admin"
    );
  }
);

test(
  "unverified structured administrator receives no access",
  () => {
    const access =
      resolveAdminAccess(
        user({
          verified: false,
        }),
        structuredProfile()
      );

    assert.equal(
      access.isAdmin,
      false
    );
  }
);

test(
  "disabled structured administrator receives no access",
  () => {
    const disabled =
      resolveAdminAccess(
        user(),
        structuredProfile({
          enabled: false,
        })
      );

    const inactive =
      resolveAdminAccess(
        user(),
        structuredProfile({
          active: false,
        })
      );

    assert.equal(
      disabled.isAdmin,
      false
    );

    assert.equal(
      inactive.isAdmin,
      false
    );
  }
);

test(
  "structured super_admin preset cannot impersonate protected Super Admin",
  () => {
    const access =
      resolveAdminAccess(
        user(),
        structuredProfile({
          preset: "super_admin",
        })
      );

    assert.equal(
      access.isAdmin,
      false
    );

    assert.equal(
      access.isSuperAdmin,
      false
    );
  }
);

test(
  "standard presets ignore stored permission escalation",
  () => {
    const access =
      resolveAdminAccess(
        user(),
        structuredProfile({
          preset:
            "all_client_viewer",

          permissions: {
            clients: {
              edit: "all",
            },

            adminManagement:
              true,
          },
        })
      );

    assert.equal(
      access.permissions.clients.edit,
      "none"
    );

    assert.equal(
      access.permissions.adminManagement,
      false
    );
  }
);

test(
  "custom preset uses validated stored permissions",
  () => {
    const access =
      resolveAdminAccess(
        user(),
        structuredProfile({
          preset:
            "custom",

          assignedClientIds: [
            "client-a",
          ],

          permissions: {
            clients: {
              view:
                "assigned",
            },

            shifts: {
              view:
                "assigned",
            },
          },
        })
      );

    assert.equal(
      access.isAdmin,
      true
    );

    assert.equal(
      access.preset,
      "custom"
    );

    assert.deepEqual(
      access.assignedClientIds,
      [
        "client-a",
      ]
    );

    assert.equal(
      access.permissions.clients.view,
      "assigned"
    );
  }
);