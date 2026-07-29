"use strict";

const test =
  require("node:test");

const assert =
  require("node:assert/strict");

const fs =
  require("node:fs");

const path =
  require("node:path");

const source =
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "src",
      "components",
      "AdminAccessManagement.jsx"
    ),
    "utf8"
  );

function count(
  pattern
) {
  return (
    source.match(pattern) ||
    []
  ).length;
}

test(
  "candidate contains seventeen state initialisers",
  () => {
    assert.equal(
      count(
        /\buseState\s*\(/g
      ),
      17
    );
  }
);

test(
  "all three inventory states are present",
  () => {
    assert.equal(
      count(
        /\[inventory,\s*setInventory\]/g
      ),
      1
    );

    assert.equal(
      count(
        /\[inventoryLoading,\s*setInventoryLoading\]/g
      ),
      1
    );

    assert.equal(
      count(
        /\[inventoryError,\s*setInventoryError\]/g
      ),
      1
    );
  }
);

test(
  "management callable references remain intact",
  () => {
    assert.equal(
      count(
        /\bmanageAdminAccessV2\b/g
      ),
      2
    );
  }
);

test(
  "inventory callable is referenced once",
  () => {
    assert.equal(
      count(
        /\bgetAdminAccessInventoryV2\b/g
      ),
      1
    );
  }
);

test(
  "one additional callable integration is present",
  () => {
    assert.equal(
      count(
        /\bhttpsCallable\b/g
      ),
      4
    );
  }
);

test(
  "manual inventory loader and button are present",
  () => {
    assert.equal(
      count(
        /const\s+loadInventory\s*=\s*async\s*\(\)\s*=>/g
      ),
      1
    );

    assert.equal(
      count(
        /onClick=\{loadInventory\}/g
      ),
      1
    );
  }
);

test(
  "inventory is not loaded automatically",
  () => {
    const start =
      source.indexOf(
        "  useEffect(() => {"
      );

    const end =
      source.indexOf(
        "  }, []);",
        start
      );

    assert.notEqual(
      start,
      -1
    );

    assert.notEqual(
      end,
      -1
    );

    const effectBlock =
      source.slice(
        start,
        end + 9
      );

    assert.match(
      effectBlock,
      /\bloadData\s*\(/
    );

    assert.doesNotMatch(
      effectBlock,
      /\bloadInventory\s*\(/
    );
  }
);

test(
  "inventory panel is protected by current Super Admin identity",
  () => {
    assert.equal(
      count(
        /isProtectedSuperAdmin\(currentUser\)/g
      ),
      1
    );
  }
);

test(
  "interface labels the results as read-only",
  () => {
    assert.match(
      source,
      /Read-only review of protected/
    );

    assert.match(
      source,
      /does not modify any user or administrator/
    );

    assert.match(
      source,
      /Read-only results/
    );
  }
);

test(
  "all four inventory metrics are rendered",
  () => {
    for (
      const field of [
        "scannedUserCount",
        "administratorCount",
        "migrationRequiredCount",
        "blockedByStructuredRulesCount",
      ]
    ) {
      assert.equal(
        count(
          new RegExp(
            `inventory\\.${field}`,
            "g"
          )
        ),
        1
      );
    }
  }
);

test(
  "category counts are rendered from the safe counts object",
  () => {
    assert.equal(
      count(
        /Object\.entries\(inventory\.counts\s*\|\|\s*\{\}\)/g
      ),
      1
    );
  }
);

test(
  "administrator review records are rendered once",
  () => {
    assert.equal(
      count(
        /inventory\.administrators\.map\s*\(/g
      ),
      1
    );

    assert.match(
      source,
      /administrator\.recommendedAction/
    );
  }
);

test(
  "candidate introduces no direct Firestore write",
  () => {
    assert.equal(
      count(
        /\b(?:setDoc|updateDoc|deleteDoc|addDoc|writeBatch|runTransaction)\s*\(/g
      ),
      0
    );
  }
);

test(
  "existing data loading and management actions remain",
  () => {
    assert.match(
      source,
      /const\s+loadData\s*=\s*async/
    );

    assert.match(
      source,
      /const\s+saveAccess\s*=\s*async/
    );

    assert.match(
      source,
      /const\s+disableAccess\s*=\s*async/
    );

    assert.match(
      source,
      /Save Access/
    );

    assert.match(
      source,
      /Disable Admin Access/
    );
  }
);

test(
  "existing user-selection interface remains",
  () => {
    assert.match(
      source,
      /const\s+selectedUser\s*=\s*useMemo/
    );

    assert.match(
      source,
      /Select a user/
    );

    assert.match(
      source,
      /User accounts/
    );
  }
);