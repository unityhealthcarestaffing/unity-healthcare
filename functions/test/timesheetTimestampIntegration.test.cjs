"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const root =
  path.resolve(
    __dirname,
    "../.."
  );

const indexSource =
  fs.readFileSync(
    path.join(
      root,
      "functions",
      "index.js"
    ),
    "utf8"
  );

const emulatorSource =
  fs.readFileSync(
    path.join(
      root,
      "tests",
      "timesheet-callable-emulator.cjs"
    ),
    "utf8"
  );

const submitStart =
  indexSource.indexOf(
    "exports.submitTimesheetV2 ="
  );

const submitEnd =
  indexSource.indexOf(
    "exports.createInvoiceOnTimesheetApprovedV2 =",
    submitStart
  );

assert.ok(
  submitStart >= 0 &&
  submitEnd >
    submitStart
);

const submitBlock =
  indexSource.slice(
    submitStart,
    submitEnd
  );

function count(
  source,
  pattern
) {
  return (
    source.match(
      pattern
    ) || []
  ).length;
}

test(
  "Functions index imports modular FieldValue and Timestamp once",
  () => {
    assert.equal(
      count(
        indexSource,
        /require\("firebase-admin\/firestore"\)/g
      ),
      1
    );

    assert.match(
      indexSource,
      /const\s*\{\s*FieldValue,\s*Timestamp,\s*\}\s*=\s*require\("firebase-admin\/firestore"\);/
    );
  }
);

test(
  "submitTimesheetV2 uses four modular Timestamp.now calls",
  () => {
    assert.equal(
      count(
        submitBlock,
        /(?:^|[^\w.])Timestamp\.now\s*\(\)/gm
      ),
      4
    );
  }
);

test(
  "submitTimesheetV2 uses modular Timestamp.fromDate",
  () => {
    assert.equal(
      count(
        submitBlock,
        /(?:^|[^\w.])Timestamp\.fromDate\s*\(/gm
      ),
      1
    );
  }
);

test(
  "submitTimesheetV2 uses modular server timestamp",
  () => {
    assert.equal(
      count(
        submitBlock,
        /(?:^|[^\w.])FieldValue\.serverTimestamp\s*\(\)/gm
      ),
      1
    );
  }
);

test(
  "submitTimesheetV2 contains no namespaced timestamp dependency",
  () => {
    assert.doesNotMatch(
      submitBlock,
      /admin\.firestore\.Timestamp/
    );

    assert.doesNotMatch(
      submitBlock,
      /admin\.firestore\.FieldValue/
    );
  }
);

test(
  "timesheet ownership writes remain intact",
  () => {
    assert.equal(
      count(
        submitBlock,
        /clientId:\s*ownership\.clientId/g
      ),
      1
    );

    assert.equal(
      count(
        submitBlock,
        /clientUid:\s*ownership\.clientUid/g
      ),
      1
    );

    assert.equal(
      count(
        submitBlock,
        /clientUserId:\s*ownership\.clientUserId/g
      ),
      1
    );

    assert.equal(
      count(
        submitBlock,
        /clientEmail:\s*ownership\.clientEmail/g
      ),
      1
    );
  }
);

test(
  "browser ownership remains excluded",
  () => {
    assert.doesNotMatch(
      submitBlock,
      /request\.data\?\.(?:clientId|clientUid|clientUserId|clientEmail)/
    );
  }
);

test(
  "five real timesheet callable tests remain present",
  () => {
    assert.equal(
      count(
        emulatorSource,
        /^test\($/gm
      ),
      5
    );

    assert.equal(
      count(
        emulatorSource,
        /"submitTimesheetV2"/g
      ),
      1
    );
  }
);