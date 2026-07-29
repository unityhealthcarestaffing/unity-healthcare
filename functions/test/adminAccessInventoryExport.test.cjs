"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const indexSource =
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "index.js"
    ),
    "utf8"
  );

const handlerSource =
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "adminAccessInventoryHandler.js"
    ),
    "utf8"
  );

function count(
  source,
  pattern
) {
  return (
    source.match(pattern) ||
    []
  ).length;
}

test(
  "inventory handler module is imported exactly once",
  () => {
    assert.equal(
      count(
        indexSource,
        /require\(["']\.\/adminAccessInventoryHandler["']\)/g
      ),
      1
    );
  }
);

test(
  "inventory callable is exported exactly once",
  () => {
    assert.equal(
      count(
        indexSource,
        /exports\.getAdminAccessInventoryV2\s*=/g
      ),
      1
    );
  }
);

test(
  "inventory callable uses onCall and the configured region",
  () => {
    assert.match(
      indexSource,
      /exports\.getAdminAccessInventoryV2\s*=\s*onCall\(\s*\{\s*region:\s*REGION\s*\}/m
    );
  }
);

test(
  "inventory factory receives Admin SDK and HttpsError",
  () => {
    assert.match(
      indexSource,
      /createAdminAccessInventoryHandler\(\{\s*admin,\s*HttpsError,\s*\}\)/m
    );
  }
);

test(
  "existing administrator management callable remains exported once",
  () => {
    assert.equal(
      count(
        indexSource,
        /exports\.manageAdminAccessV2\s*=/g
      ),
      1
    );
  }
);

test(
  "handler still requires a protected Super Admin email",
  () => {
    assert.equal(
      count(
        handlerSource,
        /\bisProtectedSuperAdminEmail\s*\(/g
      ),
      1
    );
  }
);

test(
  "handler still contains no database write operation",
  () => {
    assert.equal(
      count(
        handlerSource,
        /\.set\s*\(|\.update\s*\(|\.delete\s*\(|\.create\s*\(|\.batch\s*\(|runTransaction/g
      ),
      0
    );
  }
);

test(
  "handler remains a bounded projected users read",
  () => {
    assert.equal(
      count(
        handlerSource,
        /\.collection\(\s*"users"\s*\)/g
      ),
      1
    );

    assert.equal(
      count(
        handlerSource,
        /\.select\s*\(/g
      ),
      1
    );

    assert.equal(
      count(
        handlerSource,
        /\.limit\s*\(/g
      ),
      1
    );

    assert.equal(
      count(
        handlerSource,
        /\.get\s*\(/g
      ),
      1
    );
  }
);