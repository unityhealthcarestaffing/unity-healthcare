"use strict";

const fs =
  require("node:fs");

const {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} = require(
  "@firebase/rules-unit-testing"
);

const {
  collection,
  deleteDoc,
  doc,
  documentId,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} = require(
  "firebase/firestore"
);

const projectId =
  process.env.GCLOUD_PROJECT ||
  "demo-unity-healthcare-step37n-r4";

const rulesPath =
  process.env.FIRESTORE_PROBE_RULES_PATH ||
  "firestore.rules";

const rules =
  fs.readFileSync(
    rulesPath,
    "utf8"
  );

const emulatorHost =
  process.env.FIRESTORE_EMULATOR_HOST ||
  "127.0.0.1:8080";

const [
  host,
  portValue,
] =
  emulatorHost.split(":");

const port =
  Number(portValue);

const adminUid =
  "step37n-r4-assigned-admin";

const adminEmail =
  "step37n-r4-admin@example.test";

const assignedClientA =
  "step37n-r4-client-a";

const assignedClientB =
  "step37n-r4-client-b";

const unassignedClient =
  "step37n-r4-client-unassigned";

const assignedShift =
  "step37n-r4-shift-assigned";

const unassignedShift =
  "step37n-r4-shift-unassigned";

let environment;
let passed = 0;

function permissions() {
  return {
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
}

async function allowed(
  label,
  operation
) {
  await assertSucceeds(
    operation()
  );

  passed += 1;

  console.log(
    `PASS ${String(passed).padStart(2, "0")}: ${label}`
  );
}

async function denied(
  label,
  operation
) {
  await assertFails(
    operation()
  );

  passed += 1;

  console.log(
    `PASS ${String(passed).padStart(2, "0")}: ${label}`
  );
}

async function main() {
  environment =
    await initializeTestEnvironment({
      projectId,

      firestore: {
        host,
        port,
        rules,
      },
    });

  await environment.clearFirestore();

  await environment.withSecurityRulesDisabled(
    async (context) => {
      const database =
        context.firestore();

      await Promise.all([
        setDoc(
          doc(
            database,
            "users",
            adminUid
          ),
          {
            uid: adminUid,
            email: adminEmail,
            role: "admin",
            accountType: "admin",
            isAdmin: true,
            status: "active",
            isActive: true,

            adminAccess: {
              version: 1,
              enabled: true,
              active: true,
              preset:
                "shift_creator_assigned",

              assignedClientIds: [
                assignedClientA,
                assignedClientB,
              ],

              permissions:
                permissions(),
            },
          }
        ),

        setDoc(
          doc(
            database,
            "users",
            "step37n-r4-staff"
          ),
          {
            uid:
              "step37n-r4-staff",

            email:
              "step37n-r4-staff@example.test",

            role: "staff",
            status: "active",
            isActive: true,
          }
        ),

        setDoc(
          doc(
            database,
            "clients",
            assignedClientA
          ),
          {
            uid: assignedClientA,
            organisationName:
              "Assigned Client A",
            status: "active",
            isActive: true,
          }
        ),

        setDoc(
          doc(
            database,
            "clients",
            assignedClientB
          ),
          {
            uid: assignedClientB,
            organisationName:
              "Assigned Client B",
            status: "active",
            isActive: true,
          }
        ),

        setDoc(
          doc(
            database,
            "clients",
            unassignedClient
          ),
          {
            uid: unassignedClient,
            organisationName:
              "Unassigned Client",
            status: "active",
            isActive: true,
          }
        ),

        setDoc(
          doc(
            database,
            "shifts",
            assignedShift
          ),
          {
            clientId: assignedClientA,
            createdBy: assignedClientA,
            date: "2026-08-01",
            startTime: "08:00",
            endTime: "20:00",
            role: "Support Worker",
            status: "open",
          }
        ),

        setDoc(
          doc(
            database,
            "shifts",
            unassignedShift
          ),
          {
            clientId: unassignedClient,
            createdBy: unassignedClient,
            date: "2026-08-02",
            startTime: "08:00",
            endTime: "20:00",
            role: "Support Worker",
            status: "open",
          }
        ),
      ]);
    }
  );

  const database =
    environment
      .authenticatedContext(
        adminUid,
        {
          email: adminEmail,
          email_verified: true,
        }
      )
      .firestore();

  await allowed(
    "assigned client document read",
    () =>
      getDoc(
        doc(
          database,
          "clients",
          assignedClientA
        )
      )
  );

  await denied(
    "unassigned client document read",
    () =>
      getDoc(
        doc(
          database,
          "clients",
          unassignedClient
        )
      )
  );

  await allowed(
    "assigned clients documentId query",
    () =>
      getDocs(
        query(
          collection(
            database,
            "clients"
          ),

          where(
            documentId(),
            "in",
            [
              assignedClientA,
              assignedClientB,
            ]
          )
        )
      )
  );

  await denied(
    "full clients collection query",
    () =>
      getDocs(
        collection(
          database,
          "clients"
        )
      )
  );

  await allowed(
    "assigned shift document read",
    () =>
      getDoc(
        doc(
          database,
          "shifts",
          assignedShift
        )
      )
  );

  await denied(
    "unassigned shift document read",
    () =>
      getDoc(
        doc(
          database,
          "shifts",
          unassignedShift
        )
      )
  );

  await allowed(
    "assigned shifts clientId query",
    () =>
      getDocs(
        query(
          collection(
            database,
            "shifts"
          ),

          where(
            "clientId",
            "in",
            [
              assignedClientA,
              assignedClientB,
            ]
          )
        )
      )
  );

  await denied(
    "full shifts collection query",
    () =>
      getDocs(
        collection(
          database,
          "shifts"
        )
      )
  );

  await allowed(
    "assigned-client shift creation",
    () =>
      setDoc(
        doc(
          database,
          "shifts",
          "step37n-r4-created-assigned"
        ),
        {
          clientId: assignedClientB,
          createdBy: adminUid,
          date: "2026-08-03",
          startTime: "09:00",
          endTime: "17:00",
          role: "Support Worker",
          status: "open",
        }
      )
  );

  await denied(
    "unassigned-client shift creation",
    () =>
      setDoc(
        doc(
          database,
          "shifts",
          "step37n-r4-created-unassigned"
        ),
        {
          clientId: unassignedClient,
          createdBy: adminUid,
          date: "2026-08-04",
          startTime: "09:00",
          endTime: "17:00",
          role: "Support Worker",
          status: "open",
        }
      )
  );

  await denied(
    "assigned shift update without edit permission",
    () =>
      updateDoc(
        doc(
          database,
          "shifts",
          assignedShift
        ),
        {
          status: "booked",
        }
      )
  );

  await denied(
    "assigned shift deletion",
    () =>
      deleteDoc(
        doc(
          database,
          "shifts",
          assignedShift
        )
      )
  );

  await denied(
    "staff directory without users.view",
    () =>
      getDocs(
        collection(
          database,
          "users"
        )
      )
  );

  if (passed !== 13) {
    throw new Error(
      `Expected 13 checks; completed ${passed}.`
    );
  }

  console.log("");

  console.log(
    "SUCCESS: 13/13 assigned-client shift policy checks passed."
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (environment) {
      await environment.cleanup();
    }
  });