const fs = require("fs");

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");

const {
  doc,
  setDoc,
  updateDoc,
  getDoc,
  deleteField,
} = require("firebase/firestore");

const PROJECT_ID = "unity-healthcare-staffing";

const ORDINARY_UID = "ordinary-user";
const ORDINARY_EMAIL = "ordinary@example.com";

const PROTECTED_UID = "protected-super-admin";
const PROTECTED_EMAIL =
  "valentine@unityhealthcarestaffing.co.uk";

let testEnvironment = null;
let passed = 0;
let failed = 0;

function normalUserData(
  uid = ORDINARY_UID,
  email = ORDINARY_EMAIL,
  overrides = {}
) {
  return {
    uid,
    email,
    displayName: "Ordinary User",
    role: "staff",
    isActive: true,
    status: "active",
    onboardingCompleted: false,
    ...overrides,
  };
}

async function seedUser(uid, data) {
  await testEnvironment.withSecurityRulesDisabled(
    async (context) => {
      await setDoc(
        doc(context.firestore(), "users", uid),
        data
      );
    }
  );
}

async function runTest(name, testFunction) {
  await testEnvironment.clearFirestore();

  try {
    await testFunction();

    passed += 1;
    console.log(`PASS ${String(passed).padStart(2, "0")}: ${name}`);
  } catch (error) {
    failed += 1;

    console.error("");
    console.error(`FAIL: ${name}`);
    console.error(
      error?.message || error
    );
    console.error("");
  }
}

async function main() {
  const rules = fs.readFileSync(
    "./firestore.rules",
    "utf8"
  );

  testEnvironment =
    await initializeTestEnvironment({
      projectId: PROJECT_ID,
      firestore: {
        host: "127.0.0.1",
        port: 8080,
        rules,
      },
    });

  const ordinaryContext =
    testEnvironment.authenticatedContext(
      ORDINARY_UID,
      {
        email: ORDINARY_EMAIL,
        email_verified: true,
      }
    );

  const ordinaryDb =
    ordinaryContext.firestore();

  const protectedContext =
    testEnvironment.authenticatedContext(
      PROTECTED_UID,
      {
        email: PROTECTED_EMAIL,
        email_verified: true,
      }
    );

  const protectedDb =
    protectedContext.firestore();

  const unauthenticatedDb =
    testEnvironment
      .unauthenticatedContext()
      .firestore();

  await runTest(
    "Unauthenticated visitor cannot create a user profile",
    async () => {
      await assertFails(
        setDoc(
          doc(
            unauthenticatedDb,
            "users",
            ORDINARY_UID
          ),
          normalUserData()
        )
      );
    }
  );

  await runTest(
    "Ordinary user can create a normal personal profile",
    async () => {
      await assertSucceeds(
        setDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          normalUserData()
        )
      );
    }
  );

  await runTest(
    'Ordinary user cannot create role "admin"',
    async () => {
      await assertFails(
        setDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          normalUserData(
            ORDINARY_UID,
            ORDINARY_EMAIL,
            {
              role: "admin",
            }
          )
        )
      );
    }
  );

  await runTest(
    'Ordinary user cannot bypass role protection using "Admin"',
    async () => {
      await assertFails(
        setDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          normalUserData(
            ORDINARY_UID,
            ORDINARY_EMAIL,
            {
              role: "Admin",
            }
          )
        )
      );
    }
  );

  await runTest(
    'Ordinary user cannot create accountType "admin"',
    async () => {
      await assertFails(
        setDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          normalUserData(
            ORDINARY_UID,
            ORDINARY_EMAIL,
            {
              accountType: "admin",
            }
          )
        )
      );
    }
  );

  await runTest(
    "Ordinary user cannot create isAdmin true",
    async () => {
      await assertFails(
        setDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          normalUserData(
            ORDINARY_UID,
            ORDINARY_EMAIL,
            {
              isAdmin: true,
            }
          )
        )
      );
    }
  );

  await runTest(
    "Ordinary user cannot create an adminAccess object",
    async () => {
      await assertFails(
        setDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          normalUserData(
            ORDINARY_UID,
            ORDINARY_EMAIL,
            {
              adminAccess: {
                version: 1,
                enabled: true,
                active: true,
                preset: "super_admin",
              },
            }
          )
        )
      );
    }
  );

  await runTest(
    "Ordinary user can update a harmless profile field",
    async () => {
      await seedUser(
        ORDINARY_UID,
        normalUserData()
      );

      await assertSucceeds(
        updateDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          {
            displayName: "Updated Ordinary User",
          }
        )
      );
    }
  );

  await runTest(
    "Ordinary user cannot change their role",
    async () => {
      await seedUser(
        ORDINARY_UID,
        normalUserData()
      );

      await assertFails(
        updateDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          {
            role: "admin",
          }
        )
      );
    }
  );

  await runTest(
    "Ordinary user cannot change their accountType",
    async () => {
      await seedUser(
        ORDINARY_UID,
        normalUserData()
      );

      await assertFails(
        updateDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          {
            accountType: "admin",
          }
        )
      );
    }
  );

  await runTest(
    "Ordinary user cannot set isAdmin true",
    async () => {
      await seedUser(
        ORDINARY_UID,
        normalUserData()
      );

      await assertFails(
        updateDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          {
            isAdmin: true,
          }
        )
      );
    }
  );

  await runTest(
    "Ordinary user cannot add adminAccess",
    async () => {
      await seedUser(
        ORDINARY_UID,
        normalUserData()
      );

      await assertFails(
        updateDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          {
            adminAccess: {
              version: 1,
              enabled: true,
              active: true,
              preset: "operations_admin",
            },
          }
        )
      );
    }
  );

  await runTest(
    "Ordinary user cannot delete an existing adminAccess field",
    async () => {
      await seedUser(
        ORDINARY_UID,
        normalUserData(
          ORDINARY_UID,
          ORDINARY_EMAIL,
          {
            adminAccess: {
              version: 1,
              enabled: false,
              active: false,
              preset: "view_all",
            },
          }
        )
      );

      await assertFails(
        updateDoc(
          doc(
            ordinaryDb,
            "users",
            ORDINARY_UID
          ),
          {
            adminAccess: deleteField(),
          }
        )
      );
    }
  );

  await runTest(
    "Protected Super Admin can update another user's access",
    async () => {
      const targetUid = "managed-user";

      await seedUser(
        targetUid,
        normalUserData(
          targetUid,
          "managed@example.com"
        )
      );

      await assertSucceeds(
        updateDoc(
          doc(
            protectedDb,
            "users",
            targetUid
          ),
          {
            role: "admin",
            accountType: "admin",
            isAdmin: true,
            adminAccess: {
              version: 1,
              enabled: true,
              active: true,
              preset: "operations_admin",
              assignedClientIds: [],
              permissions: {
                clients: "all",
                shifts: "all",
                staff: "all",
                timesheets: "all",
                payroll: "all",
                invoices: "all",
                enquiries: "all",
                adminManagement: false,
              },
            },
            adminAccessUpdatedBy:
              PROTECTED_EMAIL,
          }
        )
      );
    }
  );

  await runTest(
    "Protected Super Admin can read another user's profile",
    async () => {
      const targetUid = "readable-user";

      await seedUser(
        targetUid,
        normalUserData(
          targetUid,
          "readable@example.com"
        )
      );

      await assertSucceeds(
        getDoc(
          doc(
            protectedDb,
            "users",
            targetUid
          )
        )
      );
    }
  );

  console.log("");
  console.log("========================================");
  console.log("FIRESTORE ADMIN SECURITY TEST RESULTS");
  console.log("========================================");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total:  ${passed + failed}`);
  console.log("========================================");

  if (failed > 0) {
    process.exitCode = 1;
    return;
  }

  console.log("");
  console.log(
    "SUCCESS: All administrator-security tests passed."
  );
}

main()
  .catch((error) => {
    console.error("");
    console.error(
      "FATAL TEST ERROR:",
      error?.stack || error
    );

    process.exitCode = 1;
  })
  .finally(async () => {
    if (testEnvironment) {
      await testEnvironment.cleanup();
    }
  });
