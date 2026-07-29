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

const rules =
  fs.readFileSync(
    path.join(
      root,
      "firestore.rules"
    ),
    "utf8"
  );

function functionBlock(
  startAnchor,
  endAnchor
) {
  const start =
    adminClients.indexOf(
      startAnchor
    );

  const end =
    adminClients.indexOf(
      endAnchor,
      start
    );

  assert.ok(
    start >= 0,
    `Start anchor was not found: ${startAnchor}`
  );

  assert.ok(
    end >
      start,
    `End anchor was not found: ${endAnchor}`
  );

  return adminClients.slice(
    start,
    end
  );
}

const ensureCodeBlock =
  functionBlock(
    "  const ensureClientCode = async (uid) => {",
    "  const toggleActive = async (client) => {"
  );

const toggleActiveBlock =
  functionBlock(
    "  const toggleActive = async (client) => {",
    "  // Filter + sort"
  );

const saveRatesBlock =
  functionBlock(
    "  const saveRatesDecision = async () => {",
    "  const printClient = (client) => {"
  );

test(
  "AdminClients imports the shared canAccessClient helper",
  () => {
    assert.match(
      adminClients,
      /import\s*\{\s*canAccessClient\s*\}\s*from\s*"\.\.\/utils\/adminAccess";/
    );
  }
);

test(
  "clients.edit scope is read from resolved adminAccess",
  () => {
    assert.match(
      adminClients,
      /const\s+clientEditScope\s*=\s*adminAccess\s*\?\.\s*permissions\s*\?\.\s*clients\s*\?\.\s*edit\s*\|\|\s*"none";/
    );
  }
);

test(
  "client-specific edit access delegates to canAccessClient",
  () => {
    assert.match(
      adminClients,
      /canAccessClient\(\s*adminAccess,\s*clientId,\s*clientEditScope\s*\)/
    );
  }
);

test(
  "client-code writes are guarded",
  () => {
    const guardIndex =
      ensureCodeBlock.indexOf(
        "!canEditClientRecord"
      );

    const firstWriteIndex =
      ensureCodeBlock.indexOf(
        "setDoc("
      );

    assert.ok(
      guardIndex >= 0
    );

    assert.ok(
      firstWriteIndex >
        guardIndex
    );
  }
);

test(
  "activation writes are denied before confirmation",
  () => {
    const guardIndex =
      toggleActiveBlock.indexOf(
        "!canEditClientRecord"
      );

    const confirmIndex =
      toggleActiveBlock.indexOf(
        "window.confirm"
      );

    const writeIndex =
      toggleActiveBlock.indexOf(
        "updateDoc("
      );

    assert.ok(
      guardIndex >= 0
    );

    assert.ok(
      confirmIndex >
        guardIndex
    );

    assert.ok(
      writeIndex >
        confirmIndex
    );
  }
);

test(
  "rates-review writes are denied before payload creation",
  () => {
    const guardIndex =
      saveRatesBlock.indexOf(
        "!canEditClientRecord"
      );

    const payloadIndex =
      saveRatesBlock.indexOf(
        "const payload"
      );

    const writeIndex =
      saveRatesBlock.indexOf(
        "updateDoc("
      );

    assert.ok(
      guardIndex >= 0
    );

    assert.ok(
      payloadIndex >
        guardIndex
    );

    assert.ok(
      writeIndex >
        payloadIndex
    );
  }
);

test(
  "table activation control requires client edit permission",
  () => {
    assert.match(
      adminClients,
      /disabled=\{savingId === client\.id \|\| !canEditClientRecord\(client\.id\)\}/
    );
  }
);

test(
  "modal activation control requires client edit permission",
  () => {
    assert.match(
      adminClients,
      /disabled=\{savingId === selected\.id \|\| !canEditClientRecord\(selected\.id\)\}/
    );
  }
);

test(
  "rates decision input requires client edit permission",
  () => {
    assert.match(
      adminClients,
      /value=\{ratesDecision\}[\s\S]*?disabled=\{\s*reviewSaving \|\|\s*!canEditClientRecord\(selected\.id\)\s*\}/
    );
  }
);

test(
  "internal notes input requires client edit permission",
  () => {
    assert.match(
      adminClients,
      /value=\{adminNotes\}[\s\S]*?disabled=\{\s*reviewSaving \|\|\s*!canEditClientRecord\(selected\.id\)\s*\}/
    );
  }
);

test(
  "rates-review Save button requires client edit permission",
  () => {
    assert.match(
      adminClients,
      /onClick=\{saveRatesDecision\}[\s\S]*?disabled=\{\s*reviewSaving \|\|\s*!canEditClientRecord\(selected\.id\)\s*\}/
    );
  }
);

test(
  "client Review remains available",
  () => {
    assert.match(
      adminClients,
      /onClick=\{\(\) => setSelected\(client\)\}/
    );
  }
);

test(
  "both existing print controls remain available",
  () => {
    assert.equal(
      (
        adminClients.match(
          /onClick=\{\(\) => printClient\(selected\)\}/g
        ) || []
      ).length,
      2
    );
  }
);

test(
  "all four direct writes remain present and scoped client rules are active",
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