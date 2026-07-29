"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const {
  createManageAdminAccessHandler,
} = require(
  "../adminAccessManagement"
);

class FakeHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const modulePath = path.resolve(
  __dirname,
  "../adminAccessManagement.js"
);

const indexPath = path.resolve(
  __dirname,
  "../index.js"
);

const moduleSource =
  fs.readFileSync(
    modulePath,
    "utf8"
  );

const indexSource =
  fs.readFileSync(
    indexPath,
    "utf8"
  );

function adminWithoutNamespacedFieldValue() {
  return {
    firestore() {
      return {};
    },

    auth() {
      return {};
    },
  };
}

test(
  "handler no longer directly calls the namespaced timestamp API",
  () => {
    assert.doesNotMatch(
      moduleSource,
      /admin\.firestore\.FieldValue\s*\r?\n?\s*\.serverTimestamp\s*\(/
    );
  }
);

test(
  "handler resolves and calls its timestamp dependency",
  () => {
    assert.match(
      moduleSource,
      /const\s+createServerTimestamp\s*=/
    );

    assert.match(
      moduleSource,
      /const\s+updatedAt\s*=\s*\r?\n\s*createServerTimestamp\(\);/
    );
  }
);

test(
  "Functions index imports modular FieldValue and Timestamp exactly once",
  () => {
    assert.equal(
      (
        indexSource.match(
          /require\("firebase-admin\/firestore"\)/g
        ) || []
      ).length,
      1
    );

    assert.match(
      indexSource,
      /const\s*\{\s*FieldValue,\s*Timestamp,\s*\}\s*=\s*require\("firebase-admin\/firestore"\);/
    );
  }
);

test(
  "Functions index injects modular serverTimestamp into the handler",
  () => {
    assert.match(
      indexSource,
      /serverTimestamp:\s*\(\)\s*=>\s*\r?\n\s*FieldValue\.serverTimestamp\(\)/
    );
  }
);

test(
  "factory accepts an injected timestamp when namespaced FieldValue is absent",
  () => {
    const sentinel = {
      modularTimestamp: true,
    };

    const handler =
      createManageAdminAccessHandler({
        admin:
          adminWithoutNamespacedFieldValue(),

        HttpsError:
          FakeHttpsError,

        serverTimestamp() {
          return sentinel;
        },
      });

    assert.equal(
      typeof handler,
      "function"
    );
  }
);

test(
  "factory rejects a runtime with no timestamp source",
  () => {
    assert.throws(
      () =>
        createManageAdminAccessHandler({
          admin:
            adminWithoutNamespacedFieldValue(),

          HttpsError:
            FakeHttpsError,
        }),
      /serverTimestamp is required/
    );
  }
);