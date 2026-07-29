"use strict";

const test =
  require(
    "node:test"
  );

const assert =
  require(
    "node:assert/strict"
  );

const {
  INVENTORY_CATEGORIES,
  buildAdminAccessInventory,
  classifyAdminProfile,
  normaliseEmail,
  structuredAccessIsValid,
} =
  require(
    "../adminAccessInventory"
  );

function structuredProfile({
  uid =
    "structured-admin",

  email =
    "structured@example.test",

  preset =
    "operations_admin",

  enabled =
    true,

  active =
    true,

  assignedClientIds =
    [],

  permissions =
    {},
} = {}) {
  return {
    uid,
    email,
    role:
      "admin",

    accountType:
      "admin",

    isAdmin:
      true,

    isActive:
      true,

    status:
      "active",

    adminAccess: {
      version:
        1,

      enabled,
      active,
      preset,
      assignedClientIds,
      permissions,
    },
  };
}

test(
  "all three permanent Super Admin emails are protected",
  () => {
    const emails = [
      "info@unityhealthcarestaffing.co.uk",
      "valentine@unityhealthcarestaffing.co.uk",
      "valentine.c.enyi@gmail.com",
    ];

    for (
      const email of
      emails
    ) {
      const result =
        classifyAdminProfile({
          uid:
            email,

          email,
        });

      assert.equal(
        result.category,
        INVENTORY_CATEGORIES
          .PROTECTED_SUPER_ADMIN
      );

      assert.equal(
        result.protectedAccount,
        true
      );

      assert.equal(
        result.migrationRequired,
        false
      );
    }
  }
);

test(
  "valid Operations Admin is classified as structured",
  () => {
    const result =
      classifyAdminProfile(
        structuredProfile()
      );

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .STRUCTURED_ADMIN
    );

    assert.equal(
      result.currentPreset,
      "operations_admin"
    );
  }
);

test(
  "valid assigned administrator remains structured",
  () => {
    const result =
      classifyAdminProfile(
        structuredProfile({
          preset:
            "assigned_client_manager",

          assignedClientIds: [
            "client-a",
          ],
        })
      );

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .STRUCTURED_ADMIN
    );

    assert.equal(
      result.migrationRequired,
      false
    );
  }
);

test(
  "valid custom administrator remains structured",
  () => {
    const result =
      classifyAdminProfile(
        structuredProfile({
          preset:
            "custom",

          permissions: {
            clients: {
              view:
                "assigned",

              edit:
                "none",
            },
          },

          assignedClientIds: [
            "client-a",
          ],
        })
      );

    assert.equal(
      result.structuredAccessValid,
      true
    );
  }
);

test(
  "structured adminAccess itself is an administrator identity signal",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "access-only",

        email:
          "access.only@example.test",

        adminAccess:
          structuredProfile()
            .adminAccess,
      });

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .STRUCTURED_ADMIN
    );

    assert.deepEqual(
      result.identitySignals,
      [
        "adminAccess",
      ]
    );
  }
);

test(
  "role-only administrator is classified as legacy",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "legacy-role",

        email:
          "legacy.role@example.test",

        role:
          "admin",
      });

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .LEGACY_ADMIN
    );
  }
);

test(
  "accountType-only administrator is classified as legacy",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "legacy-account-type",

        email:
          "legacy.account@example.test",

        accountType:
          "admin",
      });

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .LEGACY_ADMIN
    );
  }
);

test(
  "isAdmin-only administrator is classified as legacy",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "legacy-flag",

        email:
          "legacy.flag@example.test",

        isAdmin:
          true,
      });

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .LEGACY_ADMIN
    );
  }
);

test(
  "active legacy administrator receives preserving preset recommendation",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "legacy-preserve",

        role:
          "admin",
      });

    assert.equal(
      result.migrationRequired,
      true
    );

    assert.equal(
      result.blocksScopedAccess,
      true
    );

    assert.equal(
      result.recommendedAction,
      "review_and_assign_preset"
    );

    assert.equal(
      result.suggestedPreset,
      "operations_admin"
    );
  }
);

test(
  "unknown structured preset requires repair",
  () => {
    const profile =
      structuredProfile({
        preset:
          "unknown_preset",
      });

    const result =
      classifyAdminProfile(
        profile
      );

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .INVALID_STRUCTURED_ADMIN
    );

    assert.equal(
      result.recommendedAction,
      "repair_or_disable"
    );
  }
);

test(
  "incomplete structured access requires repair",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "partial-admin",

        role:
          "admin",

        adminAccess: {
          version:
            1,

          preset:
            "operations_admin",
        },
      });

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .INVALID_STRUCTURED_ADMIN
    );

    assert.equal(
      result.structuredAccessValid,
      false
    );
  }
);

test(
  "disabled legacy administrator is separated from active legacy access",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "disabled-legacy",

        role:
          "admin",

        isActive:
          false,
      });

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .LEGACY_DISABLED
    );

    assert.equal(
      result.recommendedAction,
      "review_and_confirm_disabled"
    );
  }
);

test(
  "disabled structured administrator is not marked for migration",
  () => {
    const result =
      classifyAdminProfile(
        structuredProfile({
          enabled:
            false,

          active:
            false,
        })
      );

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .STRUCTURED_DISABLED
    );

    assert.equal(
      result.migrationRequired,
      false
    );
  }
);

test(
  "ordinary user is classified as non-admin",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "ordinary-user",

        email:
          "ordinary@example.test",

        role:
          "staff",
      });

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .NON_ADMIN
    );

    assert.equal(
      result.blocksScopedAccess,
      false
    );
  }
);

test(
  "suspended legacy administrator is classified as disabled legacy",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "suspended-admin",

        role:
          "admin",

        status:
          "suspended",
      });

    assert.equal(
      result.category,
      INVENTORY_CATEGORIES
        .LEGACY_DISABLED
    );
  }
);

test(
  "inventory produces category and migration totals",
  () => {
    const inventory =
      buildAdminAccessInventory([
        {
          uid:
            "legacy-a",

          role:
            "admin",
        },
        structuredProfile(),
        {
          uid:
            "ordinary",

          role:
            "staff",
        },
        {
          uid:
            "invalid",

          role:
            "admin",

          adminAccess: {
            version:
              1,

            preset:
              "invalid",
          },
        },
      ]);

    assert.equal(
      inventory.total,
      4
    );

    assert.equal(
      inventory.migrationRequiredCount,
      2
    );

    assert.equal(
      inventory.blockedByStructuredRulesCount,
      2
    );

    assert.equal(
      inventory.counts
        .legacy_admin,
      1
    );

    assert.equal(
      inventory.counts
        .invalid_structured_admin,
      1
    );
  }
);

test(
  "inventory order is deterministic and prioritises migration risks",
  () => {
    const inventory =
      buildAdminAccessInventory([
        {
          uid:
            "ordinary",

          role:
            "staff",
        },
        structuredProfile({
          uid:
            "structured",
        }),
        {
          uid:
            "legacy",

          role:
            "admin",
        },
        {
          uid:
            "invalid",

          role:
            "admin",

          adminAccess: {
            version:
              1,

            preset:
              "invalid",
          },
        },
      ]);

    assert.deepEqual(
      inventory.items.map(
        (
          item
        ) =>
          item.category
      ),
      [
        "invalid_structured_admin",
        "legacy_admin",
        "structured_admin",
        "non_admin",
      ]
    );
  }
);

test(
  "classification does not mutate the supplied profile",
  () => {
    const profile =
      structuredProfile({
        assignedClientIds: [
          "client-a",
        ],
      });

    const before =
      JSON.stringify(
        profile
      );

    classifyAdminProfile(
      profile
    );

    assert.equal(
      JSON.stringify(
        profile
      ),
      before
    );
  }
);

test(
  "inventory output excludes unrelated and sensitive profile fields",
  () => {
    const result =
      classifyAdminProfile({
        uid:
          "safe-output",

        role:
          "admin",

        password:
          "secret",

        bankDetails: {
          account:
            "123",
        },

        notes:
          "private note",
      });

    assert.equal(
      Object.hasOwn(
        result,
        "password"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        result,
        "bankDetails"
      ),
      false
    );

    assert.equal(
      Object.hasOwn(
        result,
        "notes"
      ),
      false
    );
  }
);

test(
  "empty or invalid input creates an empty inventory",
  () => {
    const inventory =
      buildAdminAccessInventory(
        null
      );

    assert.equal(
      inventory.total,
      0
    );

    assert.equal(
      inventory.migrationRequiredCount,
      0
    );

    assert.deepEqual(
      inventory.items,
      []
    );

    assert.equal(
      normaliseEmail(
        " ADMIN@EXAMPLE.TEST "
      ),
      "admin@example.test"
    );

    assert.equal(
      structuredAccessIsValid(
        null
      ),
      false
    );
  }
);