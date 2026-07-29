"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  PROTECTED_SUPER_ADMIN_EMAILS,
  createCallableAdminAuthorizer,
} = require("../adminAuthorization");

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "HttpsError";
    this.code = code;
  }
}

function createFakeAdmin({
  profiles = {},
} = {}) {
  let profileReadCount = 0;

  const admin = {
    firestore() {
      return {
        collection(collectionName) {
          if (
            collectionName !== "users"
          ) {
            throw new Error(
              `Unexpected collection: ${collectionName}`
            );
          }

          return {
            doc(uid) {
              return {
                async get() {
                  profileReadCount += 1;

                  const profile =
                    profiles[uid];

                  return {
                    exists:
                      profile !== undefined,

                    data() {
                      return profile;
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  };

  return {
    admin,

    get profileReadCount() {
      return profileReadCount;
    },
  };
}

function makeRequest({
  uid = "admin-user",
  email = "admin@example.com",
  verified = true,
} = {}) {
  return {
    auth: {
      uid,

      token: {
        email,
        email_verified: verified,
      },
    },
  };
}

function makeProfile({
  preset = "operations_admin",
  enabled = true,
  active = true,
  assignedClientIds = [],
  permissions = {},
  status,
} = {}) {
  return {
    role: "admin",
    accountType: "admin",
    isAdmin: true,

    ...(status
      ? { status }
      : {}),

    adminAccess: {
      version: 1,
      enabled,
      active,
      preset,
      assignedClientIds,
      permissions,
    },
  };
}

function makeAuthorizer(environment) {
  return createCallableAdminAuthorizer({
    admin: environment.admin,
    HttpsError: FakeHttpsError,
  });
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
  "authorizer requires Admin SDK and HttpsError dependencies",
  () => {
    assert.throws(
      () =>
        createCallableAdminAuthorizer(
          {}
        ),
      /required/
    );
  }
);

test(
  "unauthenticated callable requests are rejected",
  async () => {
    const environment =
      createFakeAdmin();

    const authorizer =
      makeAuthorizer(environment);

    await expectHttpsError(
      authorizer.load({
        auth: null,
      }),
      "unauthenticated",
      /logged in/
    );
  }
);

test(
  "protected Super Admin loads without a Firestore profile read",
  async () => {
    const environment =
      createFakeAdmin();

    const authorizer =
      makeAuthorizer(environment);

    const access =
      await authorizer.load(
        makeRequest({
          email:
            PROTECTED_SUPER_ADMIN_EMAILS[0],
        })
      );

    assert.equal(
      access.isSuperAdmin,
      true
    );

    assert.equal(
      environment.profileReadCount,
      0
    );
  }
);

test(
  "unverified protected Super Admin email is rejected",
  async () => {
    const environment =
      createFakeAdmin();

    const authorizer =
      makeAuthorizer(environment);

    await expectHttpsError(
      authorizer.load(
        makeRequest({
          email:
            PROTECTED_SUPER_ADMIN_EMAILS[0],

          verified: false,
        })
      ),
      "permission-denied",
      /verified administrator email/
    );
  }
);

test(
  "structured Operations Admin profile loads successfully",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          "admin-user":
            makeProfile(),
        },
      });

    const authorizer =
      makeAuthorizer(environment);

    const access =
      await authorizer.load(
        makeRequest()
      );

    assert.equal(
      access.isAdmin,
      true
    );

    assert.equal(
      access.preset,
      "operations_admin"
    );

    assert.equal(
      environment.profileReadCount,
      1
    );
  }
);

test(
  "missing structured administrator profile is rejected",
  async () => {
    const environment =
      createFakeAdmin();

    const authorizer =
      makeAuthorizer(environment);

    await expectHttpsError(
      authorizer.load(
        makeRequest()
      ),
      "permission-denied",
      /profile could not be found/
    );
  }
);

test(
  "inactive administrator access is rejected",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          "admin-user":
            makeProfile({
              active: false,
            }),
        },
      });

    const authorizer =
      makeAuthorizer(environment);

    await expectHttpsError(
      authorizer.load(
        makeRequest()
      ),
      "permission-denied",
      /access is disabled/
    );
  }
);

test(
  "all-client shift creation permission is allowed",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          "admin-user":
            makeProfile({
              preset:
                "shift_creator_all",
            }),
        },
      });

    const authorizer =
      makeAuthorizer(environment);

    const access =
      await authorizer.requireScoped(
        makeRequest(),
        "shifts",
        "create",
        "client-z"
      );

    assert.equal(
      access.preset,
      "shift_creator_all"
    );
  }
);

test(
  "assigned-client permission allows a listed client",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          "admin-user":
            makeProfile({
              preset:
                "assigned_client_manager",

              assignedClientIds: [
                "client-a",
              ],
            }),
        },
      });

    const authorizer =
      makeAuthorizer(environment);

    const access =
      await authorizer.requireScoped(
        makeRequest(),
        "shifts",
        "assign",
        "client-a"
      );

    assert.equal(
      access.isAdmin,
      true
    );
  }
);

test(
  "assigned-client permission rejects an unlisted client",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          "admin-user":
            makeProfile({
              preset:
                "assigned_client_manager",

              assignedClientIds: [
                "client-a",
              ],
            }),
        },
      });

    const authorizer =
      makeAuthorizer(environment);

    await expectHttpsError(
      authorizer.requireScoped(
        makeRequest(),
        "shifts",
        "assign",
        "client-b"
      ),
      "permission-denied",
      /selected client/
    );
  }
);

test(
  "viewer preset cannot create shifts",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          "admin-user":
            makeProfile({
              preset:
                "all_client_viewer",
            }),
        },
      });

    const authorizer =
      makeAuthorizer(environment);

    await expectHttpsError(
      authorizer.requireScoped(
        makeRequest(),
        "shifts",
        "create",
        "client-a"
      ),
      "permission-denied",
      /selected client/
    );
  }
);

test(
  "ordinary Operations Admin cannot pass protected-only check",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          "admin-user":
            makeProfile(),
        },
      });

    const authorizer =
      makeAuthorizer(environment);

    await expectHttpsError(
      authorizer.requireProtected(
        makeRequest()
      ),
      "permission-denied",
      /Protected Super Admin/
    );
  }
);

test(
  "boolean permissions are enforced",
  async () => {
    const environment =
      createFakeAdmin({
        profiles: {
          "operations-admin":
            makeProfile(),

          "viewer-admin":
            makeProfile({
              preset:
                "all_client_viewer",
            }),
        },
      });

    const authorizer =
      makeAuthorizer(environment);

    const allowed =
      await authorizer.requireBoolean(
        makeRequest({
          uid:
            "operations-admin",
        }),
        "users",
        "manage"
      );

    assert.equal(
      allowed.isAdmin,
      true
    );

    await expectHttpsError(
      authorizer.requireBoolean(
        makeRequest({
          uid:
            "viewer-admin",
        }),
        "users",
        "manage"
      ),
      "permission-denied",
      /do not have permission/
    );
  }
);