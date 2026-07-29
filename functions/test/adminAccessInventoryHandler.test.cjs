"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const {
  INVENTORY_SELECT_FIELDS,
  MAX_INVENTORY_USERS,
  createAdminAccessInventoryHandler,
} = require(
  "../adminAccessInventoryHandler"
);

class MockHttpsError
  extends Error {
  constructor(
    code,
    message
  ) {
    super(message);

    this.name =
      "HttpsError";

    this.code =
      code;
  }
}

function createAdminMock({
  records = [],
  getError = null,
} = {}) {
  const calls = {
    firestore:
      0,

    collection:
      0,

    collectionName:
      null,

    select:
      0,

    selectedFields:
      [],

    limit:
      0,

    limitValue:
      null,

    get:
      0,
  };

  const query = {
    select(
      ...fields
    ) {
      calls.select +=
        1;

      calls.selectedFields =
        [...fields];

      return query;
    },

    limit(
      value
    ) {
      calls.limit +=
        1;

      calls.limitValue =
        value;

      return query;
    },

    async get() {
      calls.get +=
        1;

      if (
        getError
      ) {
        throw getError;
      }

      return {
        docs:
          records.map(
            (
              record,
              index
            ) => {
              const data =
                record?.data &&
                typeof record.data ===
                  "object"
                  ? record.data
                  : record;

              return {
                id:
                  String(
                    record?.id ||
                      data?.uid ||
                      `document-${index}`
                  ),

                data:
                  () => data,
              };
            }
          ),
      };
    },
  };

  const admin = {
    firestore() {
      calls.firestore +=
        1;

      return {
        collection(
          name
        ) {
          calls.collection +=
            1;

          calls.collectionName =
            name;

          return query;
        },
      };
    },
  };

  return {
    admin,
    calls,
  };
}

function protectedRequest({
  email =
    "info@unityhealthcarestaffing.co.uk",

  verified =
    true,

  data =
    {},
} = {}) {
  return {
    auth: {
      uid:
        "protected-caller",

      token: {
        email,

        email_verified:
          verified,
      },
    },

    data,
  };
}

function structuredProfile({
  uid =
    "structured-admin",

  email =
    "structured@example.test",

  preset =
    "operations_admin",
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

      enabled:
        true,

      active:
        true,

      preset,

      assignedClientIds:
        [],

      permissions:
        {},
    },
  };
}

async function expectHttpsError(
  promise,
  code
) {
  await assert.rejects(
    promise,
    (error) => {
      assert.equal(
        error instanceof
          MockHttpsError,
        true
      );

      assert.equal(
        error.code,
        code
      );

      return true;
    }
  );
}

test(
  "factory requires Admin SDK and HttpsError dependencies",
  () => {
    assert.throws(
      () =>
        createAdminAccessInventoryHandler({
          admin:
            null,

          HttpsError:
            MockHttpsError,
        }),
      /required/
    );

    const {
      admin,
    } =
      createAdminMock();

    assert.throws(
      () =>
        createAdminAccessInventoryHandler({
          admin,

          HttpsError:
            null,
        }),
      /required/
    );
  }
);

test(
  "unauthenticated requests are rejected before database access",
  async () => {
    const {
      admin,
      calls,
    } =
      createAdminMock();

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    await expectHttpsError(
      handler({
        data:
          {},
      }),
      "unauthenticated"
    );

    assert.equal(
      calls.firestore,
      0
    );
  }
);

test(
  "unverified protected email is rejected before database access",
  async () => {
    const {
      admin,
      calls,
    } =
      createAdminMock();

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    await expectHttpsError(
      handler(
        protectedRequest({
          verified:
            false,
        })
      ),
      "permission-denied"
    );

    assert.equal(
      calls.firestore,
      0
    );
  }
);

test(
  "ordinary verified callers are rejected before database access",
  async () => {
    const {
      admin,
      calls,
    } =
      createAdminMock();

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    await expectHttpsError(
      handler(
        protectedRequest({
          email:
            "ordinary@example.test",
        })
      ),
      "permission-denied"
    );

    assert.equal(
      calls.firestore,
      0
    );
  }
);

test(
  "all three protected Super Admin emails can request inventory",
  async () => {
    const emails = [
      "info@unityhealthcarestaffing.co.uk",
      "valentine@unityhealthcarestaffing.co.uk",
      "valentine.c.enyi@gmail.com",
    ];

    for (
      const email of
      emails
    ) {
      const {
        admin,
      } =
        createAdminMock();

      const handler =
        createAdminAccessInventoryHandler({
          admin,

          HttpsError:
            MockHttpsError,
        });

      const result =
        await handler(
          protectedRequest({
            email:
              ` ${email.toUpperCase()} `,
          })
        );

      assert.equal(
        result.ok,
        true
      );
    }
  }
);

test(
  "only empty request data is accepted",
  async () => {
    const first =
      createAdminMock();

    const firstHandler =
      createAdminAccessInventoryHandler({
        admin:
          first.admin,

        HttpsError:
          MockHttpsError,
      });

    const accepted =
      await firstHandler(
        protectedRequest({
          data:
            undefined,
        })
      );

    assert.equal(
      accepted.ok,
      true
    );

    const second =
      createAdminMock();

    const secondHandler =
      createAdminAccessInventoryHandler({
        admin:
          second.admin,

        HttpsError:
          MockHttpsError,
      });

    await expectHttpsError(
      secondHandler(
        protectedRequest({
          data: {
            unexpected:
              true,
          },
        })
      ),
      "invalid-argument"
    );

    assert.equal(
      second.calls.firestore,
      0
    );
  }
);

test(
  "handler performs one projected and bounded users read",
  async () => {
    const {
      admin,
      calls,
    } =
      createAdminMock();

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    await handler(
      protectedRequest()
    );

    assert.equal(
      calls.firestore,
      1
    );

    assert.equal(
      calls.collection,
      1
    );

    assert.equal(
      calls.collectionName,
      "users"
    );

    assert.equal(
      calls.select,
      1
    );

    assert.deepEqual(
      calls.selectedFields,
      [...INVENTORY_SELECT_FIELDS]
    );

    assert.equal(
      calls.limit,
      1
    );

    assert.equal(
      calls.limitValue,
      MAX_INVENTORY_USERS + 1
    );

    assert.equal(
      calls.get,
      1
    );

    assert.equal(
      calls.selectedFields.includes(
        "password"
      ),
      false
    );

    assert.equal(
      calls.selectedFields.includes(
        "bankDetails"
      ),
      false
    );
  }
);

test(
  "mixed records produce safe inventory totals",
  async () => {
    const {
      admin,
    } =
      createAdminMock({
        records: [
          {
            uid:
              "protected",

            email:
              "info@unityhealthcarestaffing.co.uk",
          },
          structuredProfile(),
          {
            uid:
              "legacy",

            email:
              "legacy@example.test",

            role:
              "admin",
          },
          {
            uid:
              "staff",

            email:
              "staff@example.test",

            role:
              "staff",
          },
        ],
      });

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    const result =
      await handler(
        protectedRequest()
      );

    assert.equal(
      result.scannedUserCount,
      4
    );

    assert.equal(
      result.administratorCount,
      3
    );

    assert.equal(
      result.migrationRequiredCount,
      1
    );

    assert.equal(
      result.blockedByStructuredRulesCount,
      1
    );

    assert.equal(
      result.counts.non_admin,
      1
    );
  }
);

test(
  "active legacy administrator receives migration recommendation",
  async () => {
    const {
      admin,
    } =
      createAdminMock({
        records: [
          {
            uid:
              "legacy-admin",

            email:
              "legacy@example.test",

            role:
              "admin",
          },
        ],
      });

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    const result =
      await handler(
        protectedRequest()
      );

    assert.equal(
      result.administrators[0]
        .category,
      "legacy_admin"
    );

    assert.equal(
      result.administrators[0]
        .recommendedAction,
      "review_and_assign_preset"
    );

    assert.equal(
      result.administrators[0]
        .suggestedPreset,
      "operations_admin"
    );
  }
);

test(
  "protected Super Admin is excluded from migration",
  async () => {
    const {
      admin,
    } =
      createAdminMock({
        records: [
          {
            uid:
              "protected",

            email:
              "valentine@unityhealthcarestaffing.co.uk",
          },
        ],
      });

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    const result =
      await handler(
        protectedRequest()
      );

    assert.equal(
      result.administrators[0]
        .category,
      "protected_super_admin"
    );

    assert.equal(
      result.administrators[0]
        .migrationRequired,
      false
    );

    assert.equal(
      result.migrationRequiredCount,
      0
    );
  }
);

test(
  "invalid structured administrator is reported for repair",
  async () => {
    const {
      admin,
    } =
      createAdminMock({
        records: [
          {
            uid:
              "invalid-admin",

            email:
              "invalid@example.test",

            role:
              "admin",

            adminAccess: {
              version:
                1,

              preset:
                "invalid",
            },
          },
        ],
      });

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    const result =
      await handler(
        protectedRequest()
      );

    assert.equal(
      result.administrators[0]
        .category,
      "invalid_structured_admin"
    );

    assert.equal(
      result.administrators[0]
        .recommendedAction,
      "repair_or_disable"
    );
  }
);

test(
  "non-administrators are counted but excluded from details",
  async () => {
    const {
      admin,
    } =
      createAdminMock({
        records: [
          structuredProfile(),
          {
            uid:
              "ordinary-staff",

            email:
              "ordinary@example.test",

            role:
              "staff",

            password:
              "must-not-return",

            notes:
              "must-not-return",
          },
        ],
      });

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    const result =
      await handler(
        protectedRequest()
      );

    assert.equal(
      result.scannedUserCount,
      2
    );

    assert.equal(
      result.administratorCount,
      1
    );

    assert.equal(
      result.administrators.length,
      1
    );

    assert.equal(
      result.administrators[0]
        .uid,
      "structured-admin"
    );

    assert.equal(
      JSON.stringify(result)
        .includes(
          "must-not-return"
        ),
      false
    );
  }
);

test(
  "inventories over the maximum profile count are rejected",
  async () => {
    const records =
      Array.from(
        {
          length:
            MAX_INVENTORY_USERS + 1,
        },
        (
          unused,
          index
        ) => ({
          uid:
            `user-${index}`,

          role:
            "staff",
        })
      );

    const {
      admin,
    } =
      createAdminMock({
        records,
      });

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    await expectHttpsError(
      handler(
        protectedRequest()
      ),
      "resource-exhausted"
    );
  }
);

test(
  "unexpected database failures return a safe internal error",
  async () => {
    const {
      admin,
    } =
      createAdminMock({
        getError:
          new Error(
            "Sensitive database failure"
          ),
      });

    const handler =
      createAdminAccessInventoryHandler({
        admin,

        HttpsError:
          MockHttpsError,
      });

    await expectHttpsError(
      handler(
        protectedRequest()
      ),
      "internal"
    );
  }
);