"use strict";

const assert =
  require("node:assert/strict");

const path =
  require("node:path");

const {
  createRequire,
} = require(
  "node:module"
);

const projectId =
  String(
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    ""
  ).trim();

if (
  !projectId.startsWith(
    "demo-"
  )
) {
  throw new Error(
    "A Firebase demo project is required."
  );
}

const firestoreHost =
  String(
    process.env.FIRESTORE_EMULATOR_HOST ||
    ""
  ).trim();

if (!firestoreHost) {
  throw new Error(
    "FIRESTORE_EMULATOR_HOST is required."
  );
}

const hostUrl =
  new URL(
    `http://${firestoreHost}`
  );

assert.ok(
  [
    "127.0.0.1",
    "localhost",
    "::1",
    "[::1]",
  ].includes(
    hostUrl.hostname
  ),
  "Firestore emulator must use a loopback host."
);

const functionsPackagePath =
  path.resolve(
    "functions",
    "package.json"
  );

const requireFromFunctions =
  createRequire(
    functionsPackagePath
  );

const {
  initializeApp,
  deleteApp,
} =
  requireFromFunctions(
    "firebase-admin/app"
  );

const {
  getFirestore,
} =
  requireFromFunctions(
    "firebase-admin/firestore"
  );

function sleep(
  milliseconds
) {
  return new Promise(
    (resolve) =>
      setTimeout(
        resolve,
        milliseconds
      )
  );
}

async function clearFirestore() {
  const response =
    await fetch(
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

async function main() {
  await clearFirestore();

  const app =
    initializeApp(
      {
        projectId,
      },
      `step37q-r2-${Date.now()}`
    );

  try {
    const database =
      getFirestore(
        app
      );

    const shiftReference =
      database
        .collection(
          "shifts"
        )
        .doc(
          `step37q-r2-shift-${Date.now()}`
        );

    const counterReference =
      database
        .collection(
          "shiftCounters"
        )
        .doc(
          "main"
        );

    const counterBefore =
      await counterReference.get();

    assert.equal(
      counterBefore.exists,
      false,
      "shiftCounters/main must start absent in the isolated emulator."
    );

    await shiftReference.set({
      clientId:
        "step37q-r2-client",

      createdBy:
        "step37q-r2-client",

      clientEmail:
        "step37q-r2-client@example.test",

      date:
        "2026-08-20",

      startTime:
        "08:00",

      endTime:
        "20:00",

      role:
        "Support Worker",

      location:
        "Step 37Q-R2 Emulator",

      status:
        "open",

      createdForTriggerRegression:
        true,
    });

    const startedAt =
      Date.now();

    const timeoutMilliseconds =
      30000;

    let shiftData =
      null;

    let counterData =
      null;

    while (
      Date.now() - startedAt <
      timeoutMilliseconds
    ) {
      const [
        shiftSnapshot,
        counterSnapshot,
      ] =
        await Promise.all([
          shiftReference.get(),
          counterReference.get(),
        ]);

      if (
        shiftSnapshot.exists &&
        counterSnapshot.exists
      ) {
        const candidateShift =
          shiftSnapshot.data() || {};

        const candidateCounter =
          counterSnapshot.data() || {};

        if (
          candidateShift.shiftId &&
          candidateShift.publicId &&
          Number.isInteger(
            candidateShift.shiftIdNumber
          ) &&
          candidateShift.shiftIdAssignedAt &&
          candidateShift.shiftIdAssignedBy &&
          Number.isInteger(
            candidateCounter.next
          )
        ) {
          shiftData =
            candidateShift;

          counterData =
            candidateCounter;

          break;
        }
      }

      await sleep(
        250
      );
    }

    assert.ok(
      shiftData,
      "The background trigger did not write all shift fields within 30 seconds."
    );

    assert.ok(
      counterData,
      "The background trigger did not commit shiftCounters/main within 30 seconds."
    );

    assert.match(
      String(
        shiftData.shiftId
      ),
      /^SH-\d{6}$/,
      "shiftId must use SH-000xxx format."
    );

    assert.equal(
      shiftData.shiftId,
      "SH-000001",
      "The first isolated allocation must be SH-000001."
    );

    assert.equal(
      shiftData.shiftIdNumber,
      1,
      "The first isolated shiftIdNumber must equal 1."
    );

    assert.equal(
      shiftData.publicId,
      shiftData.shiftId,
      "publicId must match shiftId."
    );

    assert.equal(
      typeof shiftData
        .shiftIdAssignedAt
        ?.toDate,
      "function",
      "shiftIdAssignedAt must be a Firestore timestamp."
    );

    const assignedAtDate =
      shiftData
        .shiftIdAssignedAt
        .toDate();

    assert.equal(
      Number.isNaN(
        assignedAtDate.getTime()
      ),
      false,
      "shiftIdAssignedAt must contain a valid date."
    );

    assert.equal(
      shiftData.shiftIdAssignedBy,
      "system",
      "shiftIdAssignedBy must equal system."
    );

    assert.equal(
      counterData.next,
      shiftData.shiftIdNumber + 1,
      "shiftCounters/main.next must equal shiftIdNumber plus one."
    );

    assert.equal(
      counterData.next,
      2,
      "The first allocation must store next equal to 2."
    );

    await sleep(
      2000
    );

    const [
      finalShiftSnapshot,
      finalCounterSnapshot,
    ] =
      await Promise.all([
        shiftReference.get(),
        counterReference.get(),
      ]);

    const finalShift =
      finalShiftSnapshot.data() || {};

    const finalCounter =
      finalCounterSnapshot.data() || {};

    assert.equal(
      finalShift.shiftId,
      "SH-000001",
      "The generated shift ID changed unexpectedly."
    );

    assert.equal(
      finalCounter.next,
      2,
      "The committed counter changed unexpectedly."
    );

    console.log(
      "STEP37Q_R2_SHIFT_TRIGGER_REGRESSION_PASSED"
    );

    console.log(
      `Generated shift ID: ${finalShift.shiftId}`
    );

    console.log(
      `shiftIdNumber: ${finalShift.shiftIdNumber}`
    );

    console.log(
      `publicId matches: ${finalShift.publicId === finalShift.shiftId}`
    );

    console.log(
      `audit timestamp valid: ${!Number.isNaN(assignedAtDate.getTime())}`
    );

    console.log(
      `assignment actor: ${finalShift.shiftIdAssignedBy}`
    );

    console.log(
      `counter path: shiftCounters/main`
    );

    console.log(
      `counter next: ${finalCounter.next}`
    );

    console.log(
      `next equals shiftIdNumber plus one: ${
        finalCounter.next ===
        finalShift.shiftIdNumber + 1
      }`
    );
  } finally {
    await clearFirestore();

    await deleteApp(
      app
    );
  }
}

main()
  .catch(
    (error) => {
      console.error(
        error
      );

      process.exitCode =
        1;
    }
  );