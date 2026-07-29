"use strict";

const testModule =
  require("node:test");

const {
  test,
  before,
  after,
} = testModule;

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const admin =
  require("firebase-admin");

const EXPECTED_PROJECT_ID =
  "unity-healthcare-staffing";

const FUNCTION_NAME =
  "getAdminAccessInventoryV2";

const TEST_PASSWORD =
  "EmulatorOnly!12345";

const projectRoot =
  path.join(
    __dirname,
    "..",
    ".."
  );

let projectId;
let authHost;
let firestoreHost;
let functionEndpoint;

let app;
let auth;
let db;

let protectedResponse;
let ordinaryResponse;
let unverifiedResponse;
let invalidArgumentResponse;

let beforeUsers;
let afterUsers;

function normaliseConnectHost(
  host
) {
  const cleaned =
    String(
      host || ""
    ).trim();

  if (
    cleaned ===
      "0.0.0.0"
  ) {
    return "127.0.0.1";
  }

  if (
    cleaned ===
      "::"
  ) {
    return "[::1]";
  }

  return cleaned;
}

function isLoopbackHostname(
  hostname
) {
  return [
    "127.0.0.1",
    "localhost",
    "::1",
    "[::1]",
  ].includes(
    hostname
  );
}

function assertLoopbackHost(
  hostWithPort,
  description
) {
  assert.equal(
    typeof hostWithPort,
    "string",
    `${description} must be supplied.`
  );

  assert.notEqual(
    hostWithPort.trim(),
    "",
    `${description} must not be empty.`
  );

  const parsed =
    new URL(
      `http://${hostWithPort}`
    );

  assert.equal(
    isLoopbackHostname(
      parsed.hostname
    ),
    true,
    `${description} must use a loopback host.`
  );
}

async function localFetch(
  url,
  options = {}
) {
  const parsed =
    new URL(
      url
    );

  assert.equal(
    parsed.protocol,
    "http:",
    "Emulator requests must use local HTTP."
  );

  assert.equal(
    isLoopbackHostname(
      parsed.hostname
    ),
    true,
    `External network request blocked: ${url}`
  );

  return fetch(
    url,
    options
  );
}

async function readJsonResponse(
  response
) {
  const text =
    await response.text();

  if (
    text.trim() ===
      ""
  ) {
    return {};
  }

  try {
    return JSON.parse(
      text
    );
  } catch {
    throw new Error(
      `Expected JSON response but received: ${text.slice(
        0,
        300
      )}`
    );
  }
}

async function resetAuthEmulator() {
  const response =
    await localFetch(
      `http://${authHost}/emulator/v1/projects/${encodeURIComponent(
        projectId
      )}/accounts`,
      {
        method:
          "DELETE",
      }
    );

  assert.equal(
    response.ok,
    true,
    `Auth emulator reset failed with HTTP ${response.status}.`
  );
}

async function resetFirestoreEmulator() {
  const response =
    await localFetch(
      `http://${firestoreHost}/emulator/v1/projects/${encodeURIComponent(
        projectId
      )}/databases/(default)/documents`,
      {
        method:
          "DELETE",
      }
    );

  assert.equal(
    response.ok,
    true,
    `Firestore emulator reset failed with HTTP ${response.status}.`
  );
}

async function resetEmulators() {
  await resetAuthEmulator();
  await resetFirestoreEmulator();
}

async function signIn(
  email
) {
  const response =
    await localFetch(
      `http://${authHost}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=emulator-only-key`,
      {
        method:
          "POST",

        headers: {
          "content-type":
            "application/json",
        },

        body:
          JSON.stringify({
            email,
            password:
              TEST_PASSWORD,
            returnSecureToken:
              true,
          }),
      }
    );

  const body =
    await readJsonResponse(
      response
    );

  assert.equal(
    response.ok,
    true,
    `Auth emulator sign-in failed for ${email}: ${JSON.stringify(
      body
    )}`
  );

  assert.equal(
    typeof body.idToken,
    "string"
  );

  assert.notEqual(
    body.idToken,
    ""
  );

  return body.idToken;
}

async function invokeInventoryCallable(
  idToken,
  data = {}
) {
  const response =
    await localFetch(
      functionEndpoint,
      {
        method:
          "POST",

        headers: {
          authorization:
            `Bearer ${idToken}`,

          "content-type":
            "application/json",
        },

        body:
          JSON.stringify({
            data,
          }),
      }
    );

  return {
    status:
      response.status,

    body:
      await readJsonResponse(
        response
      ),
  };
}

async function captureUsers() {
  const snapshot =
    await db
      .collection(
        "users"
      )
      .get();

  return snapshot.docs
    .map(
      (
        document
      ) => ({
        id:
          document.id,

        data:
          document.data(),
      })
    )
    .sort(
      (
        first,
        second
      ) =>
        first.id.localeCompare(
          second.id
        )
    );
}

before(
  async () => {
    authHost =
      process.env
        .FIREBASE_AUTH_EMULATOR_HOST;

    firestoreHost =
      process.env
        .FIRESTORE_EMULATOR_HOST;

    assertLoopbackHost(
      authHost,
      "FIREBASE_AUTH_EMULATOR_HOST"
    );

    assertLoopbackHost(
      firestoreHost,
      "FIRESTORE_EMULATOR_HOST"
    );

    projectId =
      process.env
        .GCLOUD_PROJECT ||
      process.env
        .GOOGLE_CLOUD_PROJECT ||
      EXPECTED_PROJECT_ID;

    assert.equal(
      projectId,
      EXPECTED_PROJECT_ID,
      "The emulator test must use the Unity Healthcare project identifier."
    );

    const firebaseConfig =
      JSON.parse(
        fs.readFileSync(
          path.join(
            projectRoot,
            "firebase.json"
          ),
          "utf8"
        )
      );

    const configuredFunctionHost =
      normaliseConnectHost(
        firebaseConfig
          ?.emulators
          ?.functions
          ?.host ||
          "127.0.0.1"
      );

    const configuredFunctionPort =
      Number(
        firebaseConfig
          ?.emulators
          ?.functions
          ?.port ||
          5001
      );

    assert.equal(
      Number.isInteger(
        configuredFunctionPort
      ),
      true
    );

    assert.equal(
      configuredFunctionPort >
        0,
      true
    );

    assertLoopbackHost(
      `${configuredFunctionHost}:${configuredFunctionPort}`,
      "Functions emulator endpoint"
    );

    const indexSource =
      fs.readFileSync(
        path.join(
          projectRoot,
          "functions",
          "index.js"
        ),
        "utf8"
      );

    const regionMatch =
      indexSource.match(
        /\bconst\s+REGION\s*=\s*["']([^"']+)["']/
      );

    assert.notEqual(
      regionMatch,
      null,
      "The Functions region could not be read from functions/index.js."
    );

    const region =
      regionMatch[1];

    functionEndpoint =
      `http://${configuredFunctionHost}:${configuredFunctionPort}/${projectId}/${region}/${FUNCTION_NAME}`;

    const endpointUrl =
      new URL(
        functionEndpoint
      );

    assert.equal(
      isLoopbackHostname(
        endpointUrl.hostname
      ),
      true
    );

    await resetEmulators();

    app =
      admin.initializeApp(
        {
          projectId,
        },
        "admin-inventory-callable-emulator-test"
      );

    auth =
      app.auth();

    db =
      app.firestore();

    const authenticationUsers = [
      {
        uid:
          "protected-caller",

        email:
          "info@unityhealthcarestaffing.co.uk",

        emailVerified:
          true,
      },
      {
        uid:
          "protected-unverified",

        email:
          "valentine@unityhealthcarestaffing.co.uk",

        emailVerified:
          false,
      },
      {
        uid:
          "ordinary-caller",

        email:
          "ordinary@example.test",

        emailVerified:
          true,
      },
      {
        uid:
          "structured-admin",

        email:
          "structured@example.test",

        emailVerified:
          true,
      },
      {
        uid:
          "legacy-admin",

        email:
          "legacy@example.test",

        emailVerified:
          true,
      },
      {
        uid:
          "staff-user",

        email:
          "staff@example.test",

        emailVerified:
          true,
      },
    ];

    for (
      const user of
      authenticationUsers
    ) {
      await auth.createUser({
        ...user,

        password:
          TEST_PASSWORD,
      });
    }

    const profiles = [
      {
        uid:
          "protected-caller",

        email:
          "info@unityhealthcarestaffing.co.uk",

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
      },
      {
        uid:
          "protected-unverified",

        email:
          "valentine@unityhealthcarestaffing.co.uk",

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
      },
      {
        uid:
          "ordinary-caller",

        email:
          "ordinary@example.test",

        role:
          "staff",

        accountType:
          "staff",

        isAdmin:
          false,

        isActive:
          true,

        status:
          "active",
      },
      {
        uid:
          "structured-admin",

        email:
          "structured@example.test",

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

          preset:
            "operations_admin",

          assignedClientIds:
            [],

          permissions:
            {},
        },
      },
      {
        uid:
          "legacy-admin",

        email:
          "legacy@example.test",

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
      },
      {
        uid:
          "staff-user",

        email:
          "staff@example.test",

        role:
          "staff",

        accountType:
          "staff",

        isAdmin:
          false,

        isActive:
          true,

        status:
          "active",
      },
    ];

    const batch =
      db.batch();

    for (
      const profile of
      profiles
    ) {
      batch.set(
        db
          .collection(
            "users"
          )
          .doc(
            profile.uid
          ),
        profile
      );
    }

    await batch.commit();

    beforeUsers =
      await captureUsers();

    const protectedToken =
      await signIn(
        "info@unityhealthcarestaffing.co.uk"
      );

    const ordinaryToken =
      await signIn(
        "ordinary@example.test"
      );

    const unverifiedToken =
      await signIn(
        "valentine@unityhealthcarestaffing.co.uk"
      );

    protectedResponse =
      await invokeInventoryCallable(
        protectedToken,
        {}
      );

    ordinaryResponse =
      await invokeInventoryCallable(
        ordinaryToken,
        {}
      );

    unverifiedResponse =
      await invokeInventoryCallable(
        unverifiedToken,
        {}
      );

    invalidArgumentResponse =
      await invokeInventoryCallable(
        protectedToken,
        {
          unexpected:
            true,
        }
      );

    afterUsers =
      await captureUsers();
  }
);

after(
  async () => {
    try {
      if (
        authHost &&
        firestoreHost &&
        projectId
      ) {
        await resetEmulators();
      }
    } finally {
      if (
        app
      ) {
        await app.delete();
      }
    }
  }
);

test(
  "emulator hosts are loopback and the project is isolated",
  () => {
    assert.equal(
      projectId,
      EXPECTED_PROJECT_ID
    );

    assertLoopbackHost(
      authHost,
      "Auth emulator"
    );

    assertLoopbackHost(
      firestoreHost,
      "Firestore emulator"
    );

    const endpoint =
      new URL(
        functionEndpoint
      );

    assert.equal(
      isLoopbackHostname(
        endpoint.hostname
      ),
      true
    );

    assert.equal(
      endpoint.pathname.endsWith(
        `/${FUNCTION_NAME}`
      ),
      true
    );
  }
);

test(
  "verified protected Super Admin receives a successful inventory",
  () => {
    assert.equal(
      protectedResponse.status,
      200
    );

    assert.equal(
      protectedResponse
        .body
        ?.result
        ?.ok,
      true
    );
  }
);

test(
  "inventory classifies all seeded emulator profiles correctly",
  () => {
    const result =
      protectedResponse
        .body
        .result;

    assert.equal(
      result.scannedUserCount,
      6
    );

    assert.equal(
      result.administratorCount,
      4
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
      result.counts
        .protected_super_admin,
      2
    );

    assert.equal(
      result.counts
        .structured_admin,
      1
    );

    assert.equal(
      result.counts
        .legacy_admin,
      1
    );

    assert.equal(
      result.counts
        .non_admin,
      2
    );
  }
);

test(
  "legacy administrator receives the migration review recommendation",
  () => {
    const legacy =
      protectedResponse
        .body
        .result
        .administrators
        .find(
          (
            administrator
          ) =>
            administrator.uid ===
              "legacy-admin"
        );

    assert.ok(
      legacy
    );

    assert.equal(
      legacy.category,
      "legacy_admin"
    );

    assert.equal(
      legacy.recommendedAction,
      "review_and_assign_preset"
    );

    assert.equal(
      legacy.suggestedPreset,
      "operations_admin"
    );
  }
);

test(
  "ordinary verified caller is denied",
  () => {
    assert.equal(
      ordinaryResponse.status,
      403
    );

    assert.equal(
      ordinaryResponse
        .body
        ?.error
        ?.status,
      "PERMISSION_DENIED"
    );
  }
);

test(
  "unverified protected email is denied",
  () => {
    assert.equal(
      unverifiedResponse.status,
      403
    );

    assert.equal(
      unverifiedResponse
        .body
        ?.error
        ?.status,
      "PERMISSION_DENIED"
    );
  }
);

test(
  "unexpected callable request fields are rejected",
  () => {
    assert.equal(
      invalidArgumentResponse.status,
      400
    );

    assert.equal(
      invalidArgumentResponse
        .body
        ?.error
        ?.status,
      "INVALID_ARGUMENT"
    );
  }
);

test(
  "inventory callable leaves emulator Firestore unchanged",
  () => {
    assert.deepEqual(
      afterUsers,
      beforeUsers
    );

    assert.equal(
      afterUsers.length,
      6
    );
  }
);