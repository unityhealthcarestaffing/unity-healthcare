"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");

const admin = require(
  "../functions/node_modules/firebase-admin"
);

const {
  initializeApp,
  deleteApp,
} = require("firebase/app");

const {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} = require("firebase/auth");

const {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} = require("firebase/functions");

const projectId =
  "unity-healthcare-staffing";

const password =
  "LocalEmulatorOnly!123456";

const firebaseConfig = {
  apiKey: "local-emulator-key",
  authDomain:
    `${projectId}.firebaseapp.com`,
  projectId,
  appId:
    "1:123456789:web:local-emulator",
};

const identities = {
  protectedCaller: {
    uid: "protected-caller",
    email:
      "info@unityhealthcarestaffing.co.uk",
    verified: true,
  },

  protectedTarget: {
    uid: "protected-target",
    email:
      "valentine@unityhealthcarestaffing.co.uk",
    verified: true,
  },

  unverifiedProtected: {
    uid: "unverified-protected",
    email:
      "valentine.c.enyi@gmail.com",
    verified: false,
  },

  ordinaryCaller: {
    uid: "ordinary-caller",
    email:
      "ordinary-caller@example.test",
    verified: true,
  },

  targetUser: {
    uid: "target-user",
    email:
      "target-user@example.test",
    verified: true,
  },
};

const clientApps = [];

let adminApp;
let adminAuth;
let adminDb;

function normaliseCallableCode(error) {
  return String(
    error?.code || ""
  ).replace(
    /^functions\//,
    ""
  );
}

async function expectCallableError(
  promise,
  expectedCode
) {
  try {
    await promise;

    assert.fail(
      `Expected callable error: ${expectedCode}`
    );
  } catch (error) {
    assert.equal(
      normaliseCallableCode(error),
      expectedCode,
      `Unexpected callable error: ${
        error?.code
      } ${error?.message}`
    );
  }
}

function createClient(
  name
) {
  const app = initializeApp(
    firebaseConfig,
    name
  );

  clientApps.push(app);

  const auth = getAuth(app);

  connectAuthEmulator(
    auth,
    "http://127.0.0.1:9099",
    {
      disableWarnings: true,
    }
  );

  const functions = getFunctions(
    app,
    "us-central1"
  );

  connectFunctionsEmulator(
    functions,
    "127.0.0.1",
    5001
  );

  return {
    app,
    auth,
    functions,

    manageAdminAccess:
      httpsCallable(
        functions,
        "manageAdminAccessV2"
      ),
  };
}

async function createSignedInClient(
  name,
  identity
) {
  const client =
    createClient(name);

  await signInWithEmailAndPassword(
    client.auth,
    identity.email,
    password
  );

  return client;
}

async function createEmulatorUser(
  identity
) {
  await adminAuth.createUser({
    uid: identity.uid,
    email: identity.email,
    password,
    emailVerified:
      identity.verified,
  });
}

async function readTargetProfile() {
  const snapshot =
    await adminDb
      .collection("users")
      .doc(
        identities.targetUser.uid
      )
      .get();

  assert.equal(
    snapshot.exists,
    true
  );

  return snapshot.data() || {};
}

async function resetTargetProfile() {
  await adminDb
    .collection("users")
    .doc(
      identities.targetUser.uid
    )
    .set({
      uid:
        identities.targetUser.uid,

      email:
        identities.targetUser.email,

      role: "staff",
      accountType: "staff",
      isAdmin: false,
      isActive: true,
      status: "active",
      displayName: "Target User",
    });
}

test.before(
  async () => {
    adminApp =
      admin.initializeApp(
        {
          projectId,
        },
        "admin-access-emulator-test"
      );

    adminAuth =
      admin.auth(adminApp);

    adminDb =
      admin.firestore(adminApp);

    for (
      const identity of
      Object.values(identities)
    ) {
      await createEmulatorUser(
        identity
      );
    }

    await adminDb
      .collection("users")
      .doc(
        identities.ordinaryCaller.uid
      )
      .set({
        uid:
          identities.ordinaryCaller.uid,

        email:
          identities.ordinaryCaller.email,

        role: "staff",
        accountType: "staff",
        isAdmin: false,
        isActive: true,
        status: "active",
      });

    await adminDb
      .collection("users")
      .doc(
        identities.protectedTarget.uid
      )
      .set({
        uid:
          identities.protectedTarget.uid,

        email:
          identities.protectedTarget.email,

        role: "admin",
        accountType: "admin",
        isAdmin: true,
        isActive: true,
        status: "active",
      });

    await resetTargetProfile();

    await adminDb
      .collection("clients")
      .doc("client-a")
      .set({
        name: "Client A",
        organisationName:
          "Client A",
        isActive: true,
        status: "active",
      });
  }
);

test.after(
  async () => {
    for (const app of clientApps) {
      await deleteApp(app);
    }

    if (adminApp) {
      await adminApp.delete();
    }
  }
);

test(
  "unauthenticated callers are rejected",
  async () => {
    const client =
      createClient(
        "unauthenticated-client"
      );

    await expectCallableError(
      client.manageAdminAccess({
        action: "save",
        targetUid:
          identities.targetUser.uid,
        enabled: true,
        active: true,
        preset:
          "operations_admin",
        assignedClientIds: [],
        permissions: {},
      }),
      "unauthenticated"
    );
  }
);

test(
  "ordinary authenticated callers are rejected",
  async () => {
    const client =
      await createSignedInClient(
        "ordinary-client",
        identities.ordinaryCaller
      );

    await expectCallableError(
      client.manageAdminAccess({
        action: "save",
        targetUid:
          identities.targetUser.uid,
        enabled: true,
        active: true,
        preset:
          "operations_admin",
        assignedClientIds: [],
        permissions: {},
      }),
      "permission-denied"
    );
  }
);

test(
  "unverified protected email is rejected",
  async () => {
    const client =
      await createSignedInClient(
        "unverified-protected-client",
        identities.unverifiedProtected
      );

    await expectCallableError(
      client.manageAdminAccess({
        action: "save",
        targetUid:
          identities.targetUser.uid,
        enabled: true,
        active: true,
        preset:
          "operations_admin",
        assignedClientIds: [],
        permissions: {},
      }),
      "permission-denied"
    );
  }
);

test(
  "protected target accounts cannot be modified",
  async () => {
    const client =
      await createSignedInClient(
        "protected-target-test-client",
        identities.protectedCaller
      );

    await expectCallableError(
      client.manageAdminAccess({
        action: "save",
        targetUid:
          identities.protectedTarget.uid,
        enabled: true,
        active: true,
        preset:
          "operations_admin",
        assignedClientIds: [],
        permissions: {},
      }),
      "permission-denied"
    );
  }
);

test(
  "Super Admin cannot be assigned as a normal preset",
  async () => {
    const client =
      await createSignedInClient(
        "super-admin-preset-client",
        identities.protectedCaller
      );

    await expectCallableError(
      client.manageAdminAccess({
        action: "save",
        targetUid:
          identities.targetUser.uid,
        enabled: true,
        active: true,
        preset: "super_admin",
        assignedClientIds: [],
        permissions: {},
      }),
      "invalid-argument"
    );
  }
);

test(
  "unknown custom permission fields are rejected",
  async () => {
    const client =
      await createSignedInClient(
        "invalid-custom-client",
        identities.protectedCaller
      );

    await expectCallableError(
      client.manageAdminAccess({
        action: "save",
        targetUid:
          identities.targetUser.uid,
        enabled: true,
        active: true,
        preset: "custom",
        assignedClientIds: [],
        permissions: {
          unexpectedPermission:
            true,
        },
      }),
      "invalid-argument"
    );
  }
);

test(
  "assigned preset requires at least one client",
  async () => {
    const client =
      await createSignedInClient(
        "assigned-without-client",
        identities.protectedCaller
      );

    await expectCallableError(
      client.manageAdminAccess({
        action: "save",
        targetUid:
          identities.targetUser.uid,
        enabled: true,
        active: true,
        preset:
          "assigned_client_manager",
        assignedClientIds: [],
        permissions: {},
      }),
      "invalid-argument"
    );
  }
);

test(
  "non-existent assigned client is rejected",
  async () => {
    const client =
      await createSignedInClient(
        "missing-client-test",
        identities.protectedCaller
      );

    await expectCallableError(
      client.manageAdminAccess({
        action: "save",
        targetUid:
          identities.targetUser.uid,
        enabled: true,
        active: true,
        preset:
          "assigned_client_manager",
        assignedClientIds: [
          "missing-client",
        ],
        permissions: {},
      }),
      "failed-precondition"
    );
  }
);

test(
  "valid Operations Admin access is stored with server audit fields",
  async () => {
    const client =
      await createSignedInClient(
        "operations-save-client",
        identities.protectedCaller
      );

    const response =
      await client
        .manageAdminAccess({
          action: "save",
          targetUid:
            identities.targetUser.uid,
          enabled: true,
          active: true,
          preset:
            "operations_admin",
          assignedClientIds: [],
          permissions: {},
        });

    assert.equal(
      response.data?.ok,
      true
    );

    const profile =
      await readTargetProfile();

    assert.equal(
      profile.role,
      "admin"
    );

    assert.equal(
      profile.accountType,
      "admin"
    );

    assert.equal(
      profile.isAdmin,
      true
    );

    assert.equal(
      profile.adminAccess
        ?.preset,
      "operations_admin"
    );

    assert.equal(
      profile.adminAccess
        ?.enabled,
      true
    );

    assert.equal(
      profile.adminAccess
        ?.active,
      true
    );

    assert.deepEqual(
      profile.adminAccess
        ?.assignedClientIds,
      []
    );

    assert.equal(
      profile
        .adminAccessUpdatedBy,
      identities.protectedCaller.email
    );

    assert.equal(
      profile.adminAccess
        ?.updatedBy,
      identities.protectedCaller.email
    );

    assert.equal(
      profile.adminAccess
        ?.updatedByUid,
      identities.protectedCaller.uid
    );

    assert.ok(
      profile
        .adminAccessUpdatedAt
    );
  }
);

test(
  "valid custom assigned access is sanitised and stored",
  async () => {
    const client =
      await createSignedInClient(
        "custom-save-client",
        identities.protectedCaller
      );

    const permissions = {
      clients: {
        view: "assigned",
        edit: "none",
      },

      shifts: {
        view: "assigned",
        create: "assigned",
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

    const response =
      await client
        .manageAdminAccess({
          action: "save",
          targetUid:
            identities.targetUser.uid,
          enabled: true,
          active: true,
          preset: "custom",
          assignedClientIds: [
            "client-a",
          ],
          permissions,
        });

    assert.equal(
      response.data?.ok,
      true
    );

    const profile =
      await readTargetProfile();

    assert.equal(
      profile.adminAccess
        ?.preset,
      "custom"
    );

    assert.deepEqual(
      profile.adminAccess
        ?.assignedClientIds,
      ["client-a"]
    );

    assert.equal(
      profile.adminAccess
        ?.permissions
        ?.clients?.view,
      "assigned"
    );

    assert.equal(
      profile.adminAccess
        ?.permissions
        ?.shifts?.create,
      "assigned"
    );

    assert.equal(
      profile.adminAccess
        ?.permissions
        ?.adminManagement,
      false
    );
  }
);

test(
  "disable action removes active administrator access",
  async () => {
    const client =
      await createSignedInClient(
        "disable-access-client",
        identities.protectedCaller
      );

    const response =
      await client
        .manageAdminAccess({
          action: "disable",
          targetUid:
            identities.targetUser.uid,
        });

    assert.equal(
      response.data?.ok,
      true
    );

    const profile =
      await readTargetProfile();

    assert.equal(
      profile.adminAccess
        ?.enabled,
      false
    );

    assert.equal(
      profile.adminAccess
        ?.active,
      false
    );

    assert.deepEqual(
      profile.adminAccess
        ?.assignedClientIds,
      []
    );

    assert.deepEqual(
      profile.adminAccess
        ?.permissions,
      {}
    );

    assert.equal(
      profile
        .adminAccessUpdatedBy,
      identities.protectedCaller.email
    );

    assert.equal(
      profile.adminAccess
        ?.updatedBy,
      identities.protectedCaller.email
    );

    assert.equal(
      profile.adminAccess
        ?.updatedByUid,
      identities.protectedCaller.uid
    );

    assert.ok(
      profile
        .adminAccessUpdatedAt
    );
  }
);