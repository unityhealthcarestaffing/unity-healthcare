"use strict";

const fs =
  require("node:fs");

const path =
  require("node:path");

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const root =
  path.resolve(
    __dirname,
    ".."
  );

const adminClients =
  fs.readFileSync(
    path.join(
      root,
      "src",
      "components",
      "AdminClients.jsx"
    ),
    "utf8"
  );

const app =
  fs.readFileSync(
    path.join(
      root,
      "src",
      "App.jsx"
    ),
    "utf8"
  );

const rules =
  fs.readFileSync(
    path.join(
      root,
      "firestore.rules"
    ),
    "utf8"
  );

const loadStart =
  adminClients.indexOf(
    "  const loadClients = async () => {"
  );

const loadEnd =
  adminClients.indexOf(
    "  // When opening a client",
    loadStart
  );

assert.ok(
  loadStart >= 0,
  "loadClients function was not found"
);

assert.ok(
  loadEnd >
    loadStart,
  "loadClients function boundary was not found"
);

const loadBlock =
  adminClients.slice(
    loadStart,
    loadEnd
  );

test(
  "AdminClients imports the tested query-plan utility",
  () => {
    assert.match(
      adminClients,
      /import\s*\{[\s\S]*ADMIN_CLIENT_READ_MODES[\s\S]*mergeAdminClientRows[\s\S]*resolveAdminClientReadPlan[\s\S]*\}\s*from\s*"\.\.\/utils\/adminClientQueryPlan";/
    );
  }
);

test(
  "AdminClients imports Firestore documentId",
  () => {
    assert.match(
      adminClients,
      /import\s*\{[^;]*\bdocumentId\b[^;]*\}\s*from\s*"firebase\/firestore";/
    );
  }
);

test(
  "AdminClients receives resolved adminAccess",
  () => {
    assert.match(
      adminClients,
      /export\s+default\s+function\s+AdminClients\s*\(\s*\{\s*currentUser\s*,\s*adminAccess\s*\}\s*\)/
    );
  }
);

test(
  "loadClients resolves a client read plan",
  () => {
    assert.match(
      loadBlock,
      /resolveAdminClientReadPlan\(\s*adminAccess\s*\)/
    );
  }
);

test(
  "empty read plans return before creating a collection query",
  () => {
    const emptyIndex =
      loadBlock.indexOf(
        "ADMIN_CLIENT_READ_MODES.EMPTY"
      );

    const collectionIndex =
      loadBlock.indexOf(
        'collection(db, "clients")'
      );

    assert.ok(
      emptyIndex >= 0
    );

    assert.ok(
      collectionIndex >
        emptyIndex
    );

    assert.match(
      loadBlock,
      /ADMIN_CLIENT_READ_MODES\.EMPTY[\s\S]*setClients\(\[\]\);[\s\S]*return;/
    );
  }
);

test(
  "all-client access retains the existing descending query",
  () => {
    assert.match(
      loadBlock,
      /ADMIN_CLIENT_READ_MODES\.ALL/
    );

    assert.match(
      loadBlock,
      /orderBy\(\s*"createdAt"\s*,\s*"desc"\s*\)/
    );
  }
);

test(
  "assigned-client access is explicitly required",
  () => {
    assert.match(
      loadBlock,
      /readPlan\.mode\s*!==\s*ADMIN_CLIENT_READ_MODES\.ASSIGNED/
    );
  }
);

test(
  "assigned reads query only planned document IDs",
  () => {
    assert.match(
      loadBlock,
      /where\(\s*documentId\(\)\s*,\s*"in"\s*,\s*clientIds\s*\)/
    );
  }
);

test(
  "assigned query chunks are loaded concurrently",
  () => {
    assert.match(
      loadBlock,
      /Promise\.all\(\s*readPlan\.chunks\.map/
    );
  }
);

test(
  "assigned rows are merged, deduplicated and sorted",
  () => {
    assert.match(
      loadBlock,
      /mergeAdminClientRows\(\s*snapshots\.map/
    );
  }
);

test(
  "client loading reacts to adminAccess changes",
  () => {
    assert.match(
      adminClients,
      /useEffect\(\(\)\s*=>\s*\{\s*loadClients\(\);\s*\},\s*\[adminAccess\]\s*\);/
    );

    assert.doesNotMatch(
      adminClients,
      /useEffect\(\(\)\s*=>\s*\{\s*loadClients\(\);\s*\},\s*\[\]\s*\);/
    );
  }
);

test(
  "App passes currentUser and adminAccess to AdminClients",
  () => {
    assert.match(
      app,
      /<AdminClients\b[\s\S]*?currentUser=\{user\}[\s\S]*?adminAccess=\{adminAccess\}[\s\S]*?\/>/
    );
  }
);

test(
  "App retains the Admin Clients tab permission gate",
  () => {
    assert.match(
      app,
      /canViewAdminTab\(\s*adminAccess\s*,\s*"admin-clients"\s*\)/
    );
  }
);

test(
  "direct client writes remain present while scoped production rules are active",
  () => {
    assert.equal(
      (
        adminClients.match(
          /\bsetDoc\s*\(/g
        ) || []
      ).length,
      2
    );

    assert.equal(
      (
        adminClients.match(
          /\bupdateDoc\s*\(/g
        ) || []
      ).length,
      2
    );

    const allowLines =
      rules.match(
        /^\s*allow\b.*$/gm
      ) || [];

    assert.equal(
      allowLines.filter(
        (
          line
        ) =>
          line.includes(
            "ruleAdminCanAccessClient"
          )
      ).length,
      2
    );
  }
);