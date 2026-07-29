"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const admin =
  require(
    "../functions/node_modules/firebase-admin"
  );

const {
  initializeApp,
  deleteApp,
} = require(
  "firebase/app"
);

const {
  connectAuthEmulator,
  getAuth,
  signInWithEmailAndPassword,
} = require(
  "firebase/auth"
);

const {
  connectFunctionsEmulator,
  getFunctions,
  httpsCallable,
} = require(
  "firebase/functions"
);

const projectId =
  "unity-healthcare-staffing";

const password =
  "TimesheetTest123!";

const firebaseConfig = {
  apiKey:
    "timesheet-emulator-api-key",

  authDomain:
    `${projectId}.firebaseapp.com`,

  projectId,

  appId:
    "1:123456789:web:timesheet-emulator-test",
};

const identities = {
  staff: {
    uid:
      "timesheet-staff-user",

    email:
      "timesheet.staff@example.test",
  },
};

const shiftIds = {
  eligible:
    "timesheet-eligible-shift",

  publicId:
    "timesheet-public-id-shift",

  wrongStaff:
    "timesheet-wrong-staff-shift",

  missingOwner:
    "timesheet-missing-owner-shift",
};

const publicShiftCodes = {
  eligible:
    "SH-990001",

  publicId:
    "SH-990002",

  wrongStaff:
    "SH-990003",

  missingOwner:
    "SH-990004",
};

const expectedOwners = {
  eligible: {
    clientId:
      "real-client-a",

    clientEmail:
      "real.client.a@example.test",

    organisation:
      "Real Client A Ltd",

    publicId:
      "CL-990001",
  },

  publicId: {
    clientId:
      "real-client-b",

    clientEmail:
      "real.client.b@example.test",

    organisation:
      "Real Client B Ltd",

    publicId:
      "CL-990002",
  },
};

const clientApps = [];

let adminApp;
let adminAuth;
let adminDb;
let staffClient;

function createClient(
  name
) {
  const app =
    initializeApp(
      firebaseConfig,
      name
    );

  clientApps.push(app);

  const auth =
    getAuth(app);

  connectAuthEmulator(
    auth,
    "http://127.0.0.1:9099",
    {
      disableWarnings: true,
    }
  );

  const functions =
    getFunctions(
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

    submitTimesheet:
      httpsCallable(
        functions,
        "submitTimesheetV2"
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

async function expectCallableError(
  promise,
  expectedCode
) {
  let capturedError = null;

  try {
    await promise;
  } catch (error) {
    capturedError =
      error;
  }

  assert.ok(
    capturedError,
    `Expected callable error ${expectedCode}.`
  );

  const actualCode =
    String(
      capturedError.code || ""
    );

  assert.ok(
    actualCode ===
      expectedCode ||
    actualCode ===
      `functions/${expectedCode}`,
    `Expected ${expectedCode}, received ${actualCode}.`
  );

  return capturedError;
}

function submissionPayload(
  shiftId
) {
  return {
    shiftId,

    breakMinutes:
      30,

    clientName:
      "Client Signatory",

    clientRole:
      "Registered Manager",

    clientSignedDate:
      "2026-07-26",

    staffSignedName:
      "Timesheet Test Staff",

    staffDeclaration:
      true,

    /*
     * Deliberately malicious browser ownership.
     * The callable must ignore all four values.
     */
    clientId:
      "browser-supplied-client",

    clientUid:
      "browser-supplied-client",

    clientUserId:
      "browser-supplied-client",

    clientEmail:
      "browser.owner@example.test",
  };
}

function shiftDateInPast() {
  return admin
    .firestore
    .Timestamp
    .fromDate(
      new Date(
        Date.now() -
          48 *
          60 *
          60 *
          1000
      )
    );
}

function ownedShift({
  publicShiftId,
  owner,
  bookedBy =
    identities.staff.uid,
}) {
  return {
    shiftId:
      publicShiftId,

    publicId:
      publicShiftId,

    status:
      "booked",

    bookedBy,

    bookedStaffId:
      bookedBy,

    date:
      shiftDateInPast(),

    startTime:
      "08:00",

    endTime:
      "16:00",

    role:
      "Support Worker",

    location:
      "Timesheet Emulator Location",

    rates: {
      staff: 14,
      client: 25,
    },

    staffRate: 14,
    clientRate: 25,

    clientId:
      owner.clientId,

    clientUid:
      owner.clientId,

    clientUserId:
      owner.clientId,

    clientEmail:
      owner.clientEmail,

    clientOrganisation:
      owner.organisation,

    clientPublicId:
      owner.publicId,
  };
}

function ownerlessShift() {
  return {
    shiftId:
      publicShiftCodes
        .missingOwner,

    publicId:
      publicShiftCodes
        .missingOwner,

    status:
      "booked",

    bookedBy:
      identities.staff.uid,

    bookedStaffId:
      identities.staff.uid,

    date:
      shiftDateInPast(),

    startTime:
      "08:00",

    endTime:
      "16:00",

    role:
      "Support Worker",

    location:
      "Ownerless Emulator Location",

    rates: {
      staff: 14,
      client: 25,
    },

    staffRate: 14,
    clientRate: 25,

    /*
     * Email alone is not authoritative ownership.
     */
    clientEmail:
      "ownerless.client@example.test",
  };
}

function timesheetIdFor(
  shiftDocumentId
) {
  return `${shiftDocumentId}_${identities.staff.uid}`;
}

async function readTimesheet(
  shiftDocumentId
) {
  return adminDb
    .collection("timesheets")
    .doc(
      timesheetIdFor(
        shiftDocumentId
      )
    )
    .get();
}

test.before(
  async () => {
    adminApp =
      admin.initializeApp(
        {
          projectId,
        },
        "timesheet-callable-emulator-test"
      );

    adminAuth =
      admin.auth(
        adminApp
      );

    adminDb =
      admin.firestore(
        adminApp
      );

    await adminAuth.createUser({
      uid:
        identities.staff.uid,

      email:
        identities.staff.email,

      password,

      emailVerified:
        true,

      displayName:
        "Timesheet Test Staff",
    });

    await adminDb
      .collection("users")
      .doc(
        identities.staff.uid
      )
      .set({
        uid:
          identities.staff.uid,

        email:
          identities.staff.email,

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

        onboardingCompleted:
          true,

        displayName:
          "Timesheet Test Staff",
      });

    await Promise.all([
      adminDb
        .collection("clients")
        .doc(
          expectedOwners
            .eligible
            .clientId
        )
        .set({
          name:
            expectedOwners
              .eligible
              .organisation,

          organisationName:
            expectedOwners
              .eligible
              .organisation,

          email:
            expectedOwners
              .eligible
              .clientEmail,

          status:
            "active",

          isActive:
            true,
        }),

      adminDb
        .collection("clients")
        .doc(
          expectedOwners
            .publicId
            .clientId
        )
        .set({
          name:
            expectedOwners
              .publicId
              .organisation,

          organisationName:
            expectedOwners
              .publicId
              .organisation,

          email:
            expectedOwners
              .publicId
              .clientEmail,

          status:
            "active",

          isActive:
            true,
        }),

      adminDb
        .collection("shifts")
        .doc(
          shiftIds.eligible
        )
        .set(
          ownedShift({
            publicShiftId:
              publicShiftCodes
                .eligible,

            owner:
              expectedOwners
                .eligible,
          })
        ),

      adminDb
        .collection("shifts")
        .doc(
          shiftIds.publicId
        )
        .set(
          ownedShift({
            publicShiftId:
              publicShiftCodes
                .publicId,

            owner:
              expectedOwners
                .publicId,
          })
        ),

      adminDb
        .collection("shifts")
        .doc(
          shiftIds.wrongStaff
        )
        .set(
          ownedShift({
            publicShiftId:
              publicShiftCodes
                .wrongStaff,

            owner:
              expectedOwners
                .eligible,

            bookedBy:
              "another-staff-user",
          })
        ),

      adminDb
        .collection("shifts")
        .doc(
          shiftIds.missingOwner
        )
        .set(
          ownerlessShift()
        ),
    ]);

    staffClient =
      await createSignedInClient(
        "timesheet-signed-staff-client",
        identities.staff
      );
  }
);

test.after(
  async () => {
    for (
      const app of
      clientApps
    ) {
      await deleteApp(app);
    }

    if (adminApp) {
      await adminApp.delete();
    }
  }
);

test(
  "unauthenticated callers cannot submit a timesheet",
  async () => {
    const anonymousClient =
      createClient(
        "timesheet-anonymous-client"
      );

    await expectCallableError(
      anonymousClient
        .submitTimesheet(
          submissionPayload(
            shiftIds.eligible
          )
        ),

      "unauthenticated"
    );
  }
);

test(
  "staff cannot submit a timesheet for another staff member's shift",
  async () => {
    await expectCallableError(
      staffClient
        .submitTimesheet(
          submissionPayload(
            shiftIds.wrongStaff
          )
        ),

      "permission-denied"
    );

    const snapshot =
      await readTimesheet(
        shiftIds.wrongStaff
      );

    assert.equal(
      snapshot.exists,
      false
    );
  }
);

test(
  "eligible staff submission stores only server-derived client ownership",
  async () => {
    const result =
      await staffClient
        .submitTimesheet(
          submissionPayload(
            shiftIds.eligible
          )
        );

    assert.deepEqual(
      result.data,
      {
        ok: true,
      }
    );

    const snapshot =
      await readTimesheet(
        shiftIds.eligible
      );

    assert.equal(
      snapshot.exists,
      true
    );

    const data =
      snapshot.data() || {};

    assert.equal(
      data.shiftId,
      shiftIds.eligible
    );

    assert.equal(
      data.shiftPublicId,
      publicShiftCodes
        .eligible
    );

    assert.equal(
      data.staffId,
      identities.staff.uid
    );

    assert.equal(
      data.clientId,
      expectedOwners
        .eligible
        .clientId
    );

    assert.equal(
      data.clientUid,
      expectedOwners
        .eligible
        .clientId
    );

    assert.equal(
      data.clientUserId,
      expectedOwners
        .eligible
        .clientId
    );

    assert.equal(
      data.clientEmail,
      expectedOwners
        .eligible
        .clientEmail
    );

    assert.equal(
      data.clientOrganisation,
      expectedOwners
        .eligible
        .organisation
    );

    assert.equal(
      data.clientPublicId,
      expectedOwners
        .eligible
        .publicId
    );

    assert.notEqual(
      data.clientId,
      "browser-supplied-client"
    );

    assert.notEqual(
      data.clientEmail,
      "browser.owner@example.test"
    );

    assert.equal(
      data.status,
      "submitted"
    );

    assert.equal(
      data.breakMinutesStaff,
      30
    );

    assert.equal(
      data.hoursWorkedStaff,
      7.5
    );

    assert.equal(
      typeof data
        .submittedAt
        ?.toDate,
      "function"
    );
  }
);

test(
  "public shift ID submission resolves and stores the correct shift owner",
  async () => {
    const payload =
      submissionPayload(
        publicShiftCodes
          .publicId
      );

    payload.breakMinutes =
      0;

    const result =
      await staffClient
        .submitTimesheet(
          payload
        );

    assert.deepEqual(
      result.data,
      {
        ok: true,
      }
    );

    const snapshot =
      await readTimesheet(
        shiftIds.publicId
      );

    assert.equal(
      snapshot.exists,
      true
    );

    const data =
      snapshot.data() || {};

    assert.equal(
      data.shiftId,
      shiftIds.publicId
    );

    assert.equal(
      data.shiftPublicId,
      publicShiftCodes
        .publicId
    );

    assert.equal(
      data.clientId,
      expectedOwners
        .publicId
        .clientId
    );

    assert.equal(
      data.clientUid,
      expectedOwners
        .publicId
        .clientId
    );

    assert.equal(
      data.clientUserId,
      expectedOwners
        .publicId
        .clientId
    );

    assert.equal(
      data.clientEmail,
      expectedOwners
        .publicId
        .clientEmail
    );

    assert.equal(
      data.hoursWorkedStaff,
      8
    );
  }
);

test(
  "missing stored ownership is rejected and browser ownership cannot rescue it",
  async () => {
    await expectCallableError(
      staffClient
        .submitTimesheet(
          submissionPayload(
            shiftIds
              .missingOwner
          )
        ),

      "failed-precondition"
    );

    const snapshot =
      await readTimesheet(
        shiftIds.missingOwner
      );

    assert.equal(
      snapshot.exists,
      false
    );
  }
);