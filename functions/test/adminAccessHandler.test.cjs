"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROTECTED_SUPER_ADMIN_EMAILS,
  createManageAdminAccessHandler,
} = require("../adminAccessManagement");

const PROTECTED_EMAIL =
  PROTECTED_SUPER_ADMIN_EMAILS[0];

const CALLER_UID = "protected-caller";
const TARGET_UID = "target-user";

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
  }
}

function createFakeAdmin({
  profiles = {},
  authUsers = {},
  clientIds = [],
  failUpdates = false,
} = {}) {
  const mutableProfiles = {
    ...profiles,
  };

  const availableClients =
    new Set(clientIds);

  const writes = [];
  let timestampNumber = 0;

  function makeSnapshot(id, value) {
    return {
      id,
      exists: value !== undefined,
      data: () => value,
    };
  }

  const db = {
    collection(collectionName) {
      return {
        doc(id) {
          if (collectionName === "users") {
            return {
              id,

              async get() {
                return makeSnapshot(
                  id,
                  mutableProfiles[id]
                );
              },

              async update(payload) {
                if (failUpdates) {
                  throw new Error(
                    "Simulated database failure"
                  );
                }

                writes.push({
                  collection: collectionName,
                  id,
                  payload,
                });

                mutableProfiles[id] = {
                  ...mutableProfiles[id],
                  ...payload,
                };
              },
            };
          }

          if (collectionName === "clients") {
            return {
              collection: collectionName,
              id,
            };
          }

          throw new Error(
            `Unexpected collection: ${collectionName}`
          );
        },
      };
    },

    async getAll(...references) {
      return references.map(
        (reference) => ({
          id: reference.id,
          exists: availableClients.has(
            reference.id
          ),
        })
      );
    },
  };

  function firestore() {
    return db;
  }

  firestore.FieldValue = {
    serverTimestamp() {
      timestampNumber += 1;

      return {
        __serverTimestamp:
          timestampNumber,
      };
    },
  };

  const admin = {
    firestore,

    auth() {
      return {
        async getUser(uid) {
          const authUser =
            authUsers[uid];

          if (!authUser) {
            const error =
              new Error("User not found");

            error.code =
              "auth/user-not-found";

            throw error;
          }

          return {
            uid,
            ...authUser,
          };
        },
      };
    },
  };

  return {
    admin,
    writes,
    profiles: mutableProfiles,
  };
}

function createHandler(environment) {
  return createManageAdminAccessHandler({
    admin: environment.admin,
    HttpsError: FakeHttpsError,
  });
}

function protectedRequest(
  data,
  {
    uid = CALLER_UID,
    email = PROTECTED_EMAIL,
    verified = true,
  } = {}
) {
  return {
    auth: {
      uid,
      token: {
        email,
        email_verified: verified,
      },
    },
    data,
  };
}

function ordinaryTargetProfile(
  overrides = {}
) {
  return {
    uid: TARGET_UID,
    email: "ordinary@example.com",
    displayName: "Ordinary User",
    role: "staff",
    isAdmin: false,
    ...overrides,
  };
}

function validSaveData(
  overrides = {}
) {
  return {
    action: "save",
    targetUid: TARGET_UID,
    enabled: true,
    active: true,
    preset: "operations_admin",
    assignedClientIds: [],
    permissions: {},
    ...overrides,
  };
}

async function expectHttpsError(
  promise,
  expectedCode,
  messagePattern
) {
  try {
    await promise;

    assert.fail(
      `Expected ${expectedCode} error.`
    );
  } catch (error) {
    assert.equal(
      error.code,
      expectedCode
    );

    if (messagePattern) {
      assert.match(
        error.message,
        messagePattern
      );
    }
  }
}

test(
  "unauthenticated requests are rejected",
  async () => {
    const environment =
      createFakeAdmin();

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler({
        data: {},
      }),
      "unauthenticated",
      /logged in/
    );
  }
);

test(
  "ordinary authenticated callers are rejected",
  async () => {
    const environment =
      createFakeAdmin();

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData(),
          {
            email:
              "ordinary@example.com",
          }
        )
      ),
      "permission-denied",
      /Protected Super Admin/
    );
  }
);

test(
  "unverified protected email is rejected",
  async () => {
    const environment =
      createFakeAdmin();

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData(),
          {
            verified: false,
          }
        )
      ),
      "permission-denied",
      /must be verified/
    );
  }
);

test(
  "unsupported actions are rejected",
  async () => {
    const environment =
      createFakeAdmin();

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest({
          action: "remove",
          targetUid: TARGET_UID,
        })
      ),
      "invalid-argument",
      /save or disable/
    );
  }
);

test(
  "unknown request fields are rejected",
  async () => {
    const environment =
      createFakeAdmin();

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData({
            hiddenPrivilege: true,
          })
        )
      ),
      "invalid-argument",
      /unsupported field/
    );
  }
);

test(
  "a protected caller cannot modify their own account",
  async () => {
    const environment =
      createFakeAdmin();

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData({
            targetUid: CALLER_UID,
          })
        )
      ),
      "permission-denied",
      /cannot be changed/
    );
  }
);

test(
  "targets without Authentication accounts are rejected",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          [TARGET_UID]:
            ordinaryTargetProfile(),
        },
      });

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData()
        )
      ),
      "not-found",
      /Authentication account/
    );
  }
);

test(
  "targets without Firestore profiles are rejected",
  async () => {
    const environment =
      createFakeAdmin({
        authUsers: {
          [TARGET_UID]: {
            email:
              "ordinary@example.com",
          },
        },
      });

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData()
        )
      ),
      "not-found",
      /profile was not found/
    );
  }
);

test(
  "protected profile emails cannot be modified",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          [TARGET_UID]:
            ordinaryTargetProfile({
              email:
                PROTECTED_SUPER_ADMIN_EMAILS[1],
            }),
        },

        authUsers: {
          [TARGET_UID]: {
            email:
              "ordinary@example.com",
          },
        },
      });

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData()
        )
      ),
      "permission-denied",
      /cannot be changed/
    );
  }
);

test(
  "protected Authentication emails cannot be modified",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          [TARGET_UID]:
            ordinaryTargetProfile(),
        },

        authUsers: {
          [TARGET_UID]: {
            email:
              PROTECTED_SUPER_ADMIN_EMAILS[2],
          },
        },
      });

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData()
        )
      ),
      "permission-denied",
      /cannot be changed/
    );
  }
);

test(
  "missing assigned clients are rejected before writing",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          [TARGET_UID]:
            ordinaryTargetProfile(),
        },

        authUsers: {
          [TARGET_UID]: {
            email:
              "ordinary@example.com",
          },
        },
      });

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData({
            preset:
              "assigned_client_viewer",

            assignedClientIds: [
              "missing-client",
            ],
          })
        )
      ),
      "failed-precondition",
      /not found/
    );

    assert.equal(
      environment.writes.length,
      0
    );
  }
);

test(
  "valid operations access writes protected server fields",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          [TARGET_UID]:
            ordinaryTargetProfile(),
        },

        authUsers: {
          [TARGET_UID]: {
            email:
              "ordinary@example.com",
          },
        },
      });

    const handler =
      createHandler(environment);

    const result = await handler(
      protectedRequest(
        validSaveData()
      )
    );

    assert.equal(result.ok, true);
    assert.equal(result.action, "save");

    assert.equal(
      environment.writes.length,
      1
    );

    const payload =
      environment.writes[0].payload;

    assert.equal(
      payload.role,
      "admin"
    );

    assert.equal(
      payload.accountType,
      "admin"
    );

    assert.equal(
      payload.isAdmin,
      true
    );

    assert.equal(
      payload.adminAccess.preset,
      "operations_admin"
    );

    assert.deepEqual(
      payload.adminAccess
        .assignedClientIds,
      []
    );

    assert.deepEqual(
      payload.adminAccess.permissions,
      {}
    );

    assert.equal(
      payload.adminAccess.updatedBy,
      PROTECTED_EMAIL
    );

    assert.equal(
      payload.adminAccess.updatedByUid,
      CALLER_UID
    );
  }
);

test(
  "valid assigned preset verifies and stores its client",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          [TARGET_UID]:
            ordinaryTargetProfile(),
        },

        authUsers: {
          [TARGET_UID]: {
            email:
              "ordinary@example.com",
          },
        },

        clientIds: [
          "client-a",
        ],
      });

    const handler =
      createHandler(environment);

    const result = await handler(
      protectedRequest(
        validSaveData({
          preset:
            "assigned_client_manager",

          assignedClientIds: [
            "client-a",
          ],
        })
      )
    );

    assert.deepEqual(
      result.adminAccess
        .assignedClientIds,
      ["client-a"]
    );

    assert.deepEqual(
      environment.writes[0]
        .payload.adminAccess
        .assignedClientIds,
      ["client-a"]
    );
  }
);

test(
  "valid custom access is sanitised by the server",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          [TARGET_UID]:
            ordinaryTargetProfile(),
        },

        authUsers: {
          [TARGET_UID]: {
            email:
              "ordinary@example.com",
          },
        },

        clientIds: [
          "client-a",
        ],
      });

    const handler =
      createHandler(environment);

    const result = await handler(
      protectedRequest(
        validSaveData({
          preset: "custom",

          assignedClientIds: [
            "client-a",
            " client-a ",
          ],

          permissions: {
            clients: {
              view: "assigned",
            },

            users: {
              view: true,
            },

            adminManagement: false,
          },
        })
      )
    );

    assert.deepEqual(
      result.adminAccess
        .assignedClientIds,
      ["client-a"]
    );

    assert.equal(
      result.adminAccess.permissions
        .clients.view,
      "assigned"
    );

    assert.equal(
      result.adminAccess.permissions
        .clients.edit,
      "none"
    );

    assert.equal(
      result.adminAccess.permissions
        .users.view,
      true
    );

    assert.equal(
      result.adminAccess.permissions
        .users.manage,
      false
    );

    assert.equal(
      result.adminAccess.permissions
        .adminManagement,
      false
    );
  }
);

test(
  "disable action stores a disabled access record only",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          [TARGET_UID]:
            ordinaryTargetProfile({
              role: "admin",
              isAdmin: true,

              adminAccess: {
                version: 1,
                enabled: true,
                active: true,
                preset:
                  "shift_creator_all",
              },
            }),
        },

        authUsers: {
          [TARGET_UID]: {
            email:
              "ordinary@example.com",
          },
        },
      });

    const handler =
      createHandler(environment);

    const result = await handler(
      protectedRequest({
        action: "disable",
        targetUid: TARGET_UID,
      })
    );

    assert.equal(result.ok, true);
    assert.equal(
      result.adminAccess.enabled,
      false
    );

    assert.equal(
      environment.writes.length,
      1
    );

    const payload =
      environment.writes[0].payload;

    assert.deepEqual(
      Object.keys(payload).sort(),
      [
        "adminAccess",
        "adminAccessUpdatedAt",
        "adminAccessUpdatedBy",
      ]
    );

    assert.equal(
      payload.adminAccess.enabled,
      false
    );

    assert.equal(
      payload.adminAccess.active,
      false
    );

    assert.equal(
      payload.adminAccess.preset,
      "shift_creator_all"
    );

    assert.equal(
      "role" in payload,
      false
    );

    assert.equal(
      "isAdmin" in payload,
      false
    );
  }
);

test(
  "unexpected database failures return a safe internal error",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          [TARGET_UID]:
            ordinaryTargetProfile(),
        },

        authUsers: {
          [TARGET_UID]: {
            email:
              "ordinary@example.com",
          },
        },

        failUpdates: true,
      });

    const handler =
      createHandler(environment);

    await expectHttpsError(
      handler(
        protectedRequest(
          validSaveData()
        )
      ),
      "internal",
      /could not be updated/
    );
  }
);