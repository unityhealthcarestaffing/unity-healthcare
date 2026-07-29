"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require(
  "@firebase/rules-unit-testing"
);

const {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  deleteDoc,
} = require(
  "firebase/firestore"
);

const emulatorHost =
  process.env
    .FIRESTORE_EMULATOR_HOST;

if (
  !emulatorHost ||
  !/^(127\.0\.0\.1|localhost):\d+$/.test(
    emulatorHost
  )
) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST must be loopback-only."
  );
}

const [
  host,
  portText,
] =
  emulatorHost.split(":");

const port =
  Number(portText);

const projectId =
  process.env.GCLOUD_PROJECT ||
  process.env.GOOGLE_CLOUD_PROJECT ||
  process.env.FIREBASE_PROJECT;

if (
  !projectId ||
  !projectId.startsWith(
    "demo-"
  )
) {
  throw new Error(
    "This test requires a demo Firebase project."
  );
}

const rulesPath =
  path.resolve(
    process.cwd(),
    "firestore.rules"
  );

const rules =
  fs.readFileSync(
    rulesPath,
    "utf8"
  );

let environment;

function structuredAdmin({
  preset,
  assignedClientIds = [],
}) {
  return {
    role: "admin",
    accountType: "admin",
    isAdmin: true,
    isActive: true,
    status: "active",

    adminAccess: {
      version: 1,
      enabled: true,
      active: true,
      preset,
      assignedClientIds,
      permissions: {},
    },
  };
}

async function seed() {
  await environment
    .withSecurityRulesDisabled(
      async (
        context
      ) => {
        const database =
          context.firestore();

        await setDoc(
          doc(
            database,
            "users",
            "operations-admin"
          ),
          structuredAdmin({
            preset:
              "operations_admin",
          })
        );

        await setDoc(
          doc(
            database,
            "users",
            "assigned-manager"
          ),
          structuredAdmin({
            preset:
              "assigned_client_manager",

            assignedClientIds: [
              "client-assigned",
            ],
          })
        );

        for (
          const clientId of
          [
            "client-operations",
            "client-assigned",
            "client-other",
            "client-protected",
            "client-unverified",
            "client-ordinary",
          ]
        ) {
          await setDoc(
            doc(
              database,
              "clients",
              clientId
            ),
            {
              name:
                clientId,

              organisationName:
                clientId,

              status:
                "active",

              isActive:
                true,
            }
          );
        }
      }
    );
}

async function documentExists(
  collectionName,
  documentId
) {
  let exists =
    false;

  await environment
    .withSecurityRulesDisabled(
      async (
        context
      ) => {
        const snapshot =
          await getDoc(
            doc(
              context.firestore(),
              collectionName,
              documentId
            )
          );

        exists =
          snapshot.exists();
      }
    );

  return exists;
}

test.before(
  async () => {
    environment =
      await initializeTestEnvironment({
        projectId,

        firestore: {
          host,
          port,
          rules,
        },
      });

    await environment
      .clearFirestore();

    await seed();
  }
);

test.after(
  async () => {
    if (environment) {
      await environment
        .cleanup();
    }
  }
);

test(
  "clients.edit permits updates but never grants client deletion",
  async () => {
    const operationsDb =
      environment
        .authenticatedContext(
          "operations-admin",
          {
            email:
              "operations@example.test",

            email_verified:
              true,
          }
        )
        .firestore();

    const assignedManagerDb =
      environment
        .authenticatedContext(
          "assigned-manager",
          {
            email:
              "manager@example.test",

            email_verified:
              true,
          }
        )
        .firestore();

    const ordinaryDb =
      environment
        .authenticatedContext(
          "ordinary-user",
          {
            email:
              "ordinary@example.test",

            email_verified:
              true,
          }
        )
        .firestore();

    const protectedDb =
      environment
        .authenticatedContext(
          "protected-super-admin",
          {
            email:
              "info@unityhealthcarestaffing.co.uk",

            email_verified:
              true,
          }
        )
        .firestore();

    const unverifiedProtectedDb =
      environment
        .authenticatedContext(
          "unverified-protected",
          {
            email:
              "valentine@unityhealthcarestaffing.co.uk",

            email_verified:
              false,
          }
        )
        .firestore();

    await assertSucceeds(
      updateDoc(
        doc(
          operationsDb,
          "clients",
          "client-operations"
        ),
        {
          organisationName:
            "Operations updated",
        }
      )
    );

    await assertFails(
      deleteDoc(
        doc(
          operationsDb,
          "clients",
          "client-operations"
        )
      )
    );

    assert.equal(
      await documentExists(
        "clients",
        "client-operations"
      ),
      true
    );

    await assertSucceeds(
      updateDoc(
        doc(
          assignedManagerDb,
          "clients",
          "client-assigned"
        ),
        {
          organisationName:
            "Assigned manager updated",
        }
      )
    );

    await assertFails(
      deleteDoc(
        doc(
          assignedManagerDb,
          "clients",
          "client-assigned"
        )
      )
    );

    await assertFails(
      updateDoc(
        doc(
          assignedManagerDb,
          "clients",
          "client-other"
        ),
        {
          organisationName:
            "Unauthorised update",
        }
      )
    );

    assert.equal(
      await documentExists(
        "clients",
        "client-assigned"
      ),
      true
    );

    await assertFails(
      updateDoc(
        doc(
          ordinaryDb,
          "clients",
          "client-ordinary"
        ),
        {
          organisationName:
            "Ordinary update",
        }
      )
    );

    await assertFails(
      deleteDoc(
        doc(
          ordinaryDb,
          "clients",
          "client-ordinary"
        )
      )
    );

    await assertFails(
      deleteDoc(
        doc(
          unverifiedProtectedDb,
          "clients",
          "client-unverified"
        )
      )
    );

    assert.equal(
      await documentExists(
        "clients",
        "client-unverified"
      ),
      true
    );

    await assertSucceeds(
      deleteDoc(
        doc(
          protectedDb,
          "clients",
          "client-protected"
        )
      )
    );

    assert.equal(
      await documentExists(
        "clients",
        "client-protected"
      ),
      false
    );
  }
);