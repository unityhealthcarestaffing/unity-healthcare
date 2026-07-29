"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const indexPath = path.resolve(
  __dirname,
  "../index.js"
);

const source = fs.readFileSync(
  indexPath,
  "utf8"
);

function extractExport(name) {
  const startPattern =
    new RegExp(
      `^\\s*exports\\.${name}\\s*=`,
      "m"
    );

  const match =
    startPattern.exec(source);

  assert.ok(
    match,
    `Missing export: ${name}`
  );

  const start = match.index;

  const remaining =
    source.slice(
      start + match[0].length
    );

  const next =
    /^\s*exports\.[A-Za-z0-9_]+\s*=/m
      .exec(remaining);

  const end = next
    ? start +
      match[0].length +
      next.index
    : source.length;

  return source.slice(start, end);
}

const backfillBlock =
  extractExport(
    "backfillShiftIdsV2"
  );

const createBlock =
  extractExport(
    "adminCreateShiftV2"
  );

const assignBlock =
  extractExport(
    "adminAssignShiftV2"
  );

test(
  "shared callable authorizer is imported and instantiated once",
  () => {
    assert.equal(
      (
        source.match(
          /require\("\.\/adminAuthorization"\)/g
        ) || []
      ).length,
      1
    );

    assert.equal(
      (
        source.match(
          /const\s+callableAdminAuthorizer\s*=/g
        ) || []
      ).length,
      1
    );
  }
);

test(
  "shift-ID backfill requires protected Super Admin access",
  () => {
    assert.match(
      backfillBlock,
      /callableAdminAuthorizer[\s\S]*?\.requireProtected\(request\)/
    );

    assert.doesNotMatch(
      backfillBlock,
      /\bisAdminEmail\s*\(/
    );
  }
);

test(
  "shift creation loads structured administrator access",
  () => {
    assert.match(
      createBlock,
      /callableAdminAuthorizer[\s\S]*?\.load\(request\)/
    );

    assert.doesNotMatch(
      createBlock,
      /\bisAdminEmail\s*\(/
    );
  }
);

test(
  "shift creation checks shifts.create before database access",
  () => {
    assert.match(
      createBlock,
      /\.assertScoped\([\s\S]*?adminAccess,[\s\S]*?"shifts",[\s\S]*?"create",[\s\S]*?clientId/
    );

    const loadIndex =
      createBlock.indexOf(
        ".load(request)"
      );

    const clientIndex =
      createBlock.indexOf(
        "const clientId ="
      );

    const permissionIndex =
      createBlock.indexOf(
        ".assertScoped("
      );

    const databaseIndex =
      createBlock.indexOf(
        "const db = admin.firestore();"
      );

    assert.ok(
      loadIndex >= 0 &&
        clientIndex > loadIndex &&
        permissionIndex >
          clientIndex &&
        databaseIndex >
          permissionIndex
    );
  }
);

test(
  "shift assignment loads structured administrator access",
  () => {
    assert.match(
      assignBlock,
      /callableAdminAuthorizer[\s\S]*?\.load\(request\)/
    );

    assert.doesNotMatch(
      assignBlock,
      /\bisAdminEmail\s*\(/
    );
  }
);

test(
  "shift assignment derives the client from stored shift data",
  () => {
    assert.match(
      assignBlock,
      /const\s+shiftClientId\s*=[\s\S]*?shift\.clientId[\s\S]*?shift\.clientUid[\s\S]*?shift\.clientUserId/
    );
  }
);

test(
  "shift assignment checks shifts.assign before updating the shift",
  () => {
    assert.match(
      assignBlock,
      /\.assertScoped\([\s\S]*?adminAccess,[\s\S]*?"shifts",[\s\S]*?"assign",[\s\S]*?shiftClientId/
    );

    const transactionIndex =
      assignBlock.indexOf(
        "db.runTransaction"
      );

    const shiftDataIndex =
      assignBlock.indexOf(
        "shiftSnapshot.data()"
      );

    const permissionIndex =
      assignBlock.indexOf(
        ".assertScoped("
      );

    const updateIndex =
      assignBlock.indexOf(
        "transaction.update(shiftRef"
      );

    assert.ok(
      transactionIndex >= 0 &&
        shiftDataIndex >
          transactionIndex &&
        permissionIndex >
          shiftDataIndex &&
        updateIndex >
          permissionIndex
    );
  }
);

test(
  "no target callable retains the legacy email-list check",
  () => {
    const combined =
      backfillBlock +
      createBlock +
      assignBlock;

    assert.equal(
      (
        combined.match(
          /\bisAdminEmail\s*\(/g
        ) || []
      ).length,
      0
    );

    /*
     * The sole remaining reference is the
     * currently unused legacy helper definition.
     */
    assert.equal(
      (
        source.match(
          /\bisAdminEmail\s*\(/g
        ) || []
      ).length,
      1
    );
  }
);