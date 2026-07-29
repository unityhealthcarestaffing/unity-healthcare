import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

const app = fs.readFileSync(
  path.join(root, "src", "App.jsx"),
  "utf8"
);

const shifts = fs.readFileSync(
  path.join(
    root,
    "src",
    "components",
    "AdminShifts.jsx"
  ),
  "utf8"
);

const rules = fs.readFileSync(
  path.join(root, "firestore.rules"),
  "utf8"
);

test(
  "App passes resolved adminAccess to AdminShifts",
  () => {
    assert.match(
      app,
      /<AdminShifts[\s\S]{0,300}currentUser=\{user\}[\s\S]{0,300}adminAccess=\{adminAccess\}/
    );
  }
);

test(
  "AdminShifts accepts resolved adminAccess",
  () => {
    assert.match(
      shifts,
      /function\s+AdminShifts\s*\(\s*\{\s*currentUser\s*,\s*adminAccess\s*\}\s*\)/
    );
  }
);

test(
  "assigned clients use document ID in-query chunks",
  () => {
    assert.match(
      shifts,
      /where\(\s*documentId\(\)\s*,\s*"in"\s*,\s*clientIdChunk\s*\)/
    );
  }
);

test(
  "assigned shifts use clientId in-query chunks",
  () => {
    assert.match(
      shifts,
      /where\(\s*"clientId"\s*,\s*"in"\s*,\s*clientIdChunk\s*\)/
    );
  }
);

test(
  "staff directory is skipped without users.view",
  () => {
    const loader =
      shifts.indexOf(
        "const loadStaffMembers = async () => {"
      );

    const guard =
      shifts.indexOf(
        "if (!canViewUsers)",
        loader
      );

    const usersQuery =
      shifts.indexOf(
        'collection(db, "users")',
        loader
      );

    assert.ok(loader >= 0);
    assert.ok(guard > loader);
    assert.ok(usersQuery > guard);
  }
);

test(
  "individual staff profile reads are gated",
  () => {
    const userRead =
      shifts.indexOf(
        'doc(db, "users", uid)'
      );

    const guard =
      shifts.lastIndexOf(
        "if (!canViewUsers)",
        userRead
      );

    assert.ok(userRead >= 0);
    assert.ok(guard >= 0);
    assert.ok(guard < userRead);
  }
);

test(
  "shift creation is restricted to permitted clients",
  () => {
    assert.match(
      shifts,
      /canCreateShiftForClient\(\s*createShiftForm\.clientId\s*\)/
    );

    assert.match(
      shifts,
      /\{canCreateAnyShift\s*&&\s*\(/
    );
  }
);

test(
  "edit assignment and cancellation actions are gated",
  () => {
    assert.match(
      shifts,
      /canEditShiftForClient/
    );

    assert.match(
      shifts,
      /canAssignShiftForClient/
    );

    assert.match(
      shifts,
      /canCancelShiftForClient/
    );

    assert.match(
      shifts,
      /\{canMutateAnyShift\s*&&\s*\(/
    );
  }
);

test(
  "Firestore rules grant assigned shift read and create",
  () => {
    assert.match(
      rules,
      /ruleAdminCanAccessClient\(\s*"shifts"\s*,\s*"view"\s*,\s*resource\.data\.clientId\s*\)/
    );

    assert.match(
      rules,
      /ruleAdminCanAccessClient\(\s*"shifts"\s*,\s*"create"\s*,\s*request\.resource\.data\.clientId\s*\)/
    );
  }
);

test(
  "structured shift update and delete remain restricted",
  () => {
    assert.doesNotMatch(
      rules,
      /ruleAdminCanAccessClient\(\s*"shifts"\s*,\s*"edit"/
    );

    assert.doesNotMatch(
      rules,
      /ruleAdminCanAccessClient\(\s*"shifts"\s*,\s*"cancel"/
    );
  }
);