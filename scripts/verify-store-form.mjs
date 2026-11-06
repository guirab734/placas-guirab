import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import ts from "typescript";

const source = path => ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const data = code => `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`;
const calendar = data(source("../app/lib/calendar-date.ts"));
const form = data(source("../app/lib/store-form.ts").replace('"./calendar-date"', JSON.stringify(calendar)));
const { initialJoinedAt, joinedAtForSave, manualFormFields, initialReviewCount, shouldAutoLocate } = await import(form);

for (const [timezone, expected] of [["Pacific/Kiritimati", "2026-10-16"], ["America/Los_Angeles", "2026-10-15"]]) {
  const script = `import assert from "node:assert/strict";
    const { deviceCalendarDate } = await import(${JSON.stringify(calendar)});
    const { initialJoinedAt, joinedAtForSave } = await import(${JSON.stringify(form)});
    const instant = new Date("2026-10-16T03:00:00Z");
    assert.equal(deviceCalendarDate(instant), ${JSON.stringify(expected)});
    assert.equal(initialJoinedAt({joinedAt:null,targetUrl:""}, instant), ${JSON.stringify(expected)});
    const before = new Date(2026,9,15,23,59,59), after = new Date(2026,9,16,0,0,1);
    const shown = initialJoinedAt({joinedAt:null,targetUrl:""}, before);
    assert.equal(shown,"2026-10-15");
    assert.equal(joinedAtForSave({joinedAt:null,targetUrl:""}, shown, false, true, after),"2026-10-16");
    assert.equal(joinedAtForSave({joinedAt:null,targetUrl:""}, shown, true, true, after),"2026-10-15");`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { encoding: "utf8", env: { ...process.env, TZ: timezone } });
  assert.equal(result.status, 0, `Device calendar check failed in ${timezone}: ${result.stderr}`);
}

const instant = new Date("2026-10-16T03:00:00Z"), link = "https://g.page/r/existing/review";
assert.equal(initialJoinedAt({ joinedAt: "2024-02-29", targetUrl: "" }, instant), "2024-02-29");
assert.equal(initialJoinedAt({ joinedAt: "2024-02-29", targetUrl: link }, instant), "2024-02-29");
assert.equal(initialJoinedAt({ joinedAt: null, targetUrl: link }, instant), "", "Never invent a historical date");
assert.equal(joinedAtForSave({ joinedAt: "2024-02-29", targetUrl: link }, "2024-02-29", false, true, instant), "2024-02-29");
assert.equal(joinedAtForSave({ joinedAt: null, targetUrl: link }, "", false, true, instant), null);
assert.equal(joinedAtForSave({ joinedAt: null, targetUrl: "" }, "", false, false, instant), null);

const empty = { currentReviews: "", address: "", neighborhood: "", businessPhone: "" };
const unknownLocation = { latitude: null, longitude: null };
assert.deepEqual(manualFormFields(empty, unknownLocation), { currentReviews: null, address: "", neighborhood: "", businessPhone: "", latitude: null, longitude: null });
assert.deepEqual(manualFormFields({ ...empty, currentReviews: "0", address: " Endereço de teste ", neighborhood: " Bairro de teste " }, { latitude: 0, longitude: 0 }), {
  currentReviews: 0, address: "Endereço de teste", neighborhood: "Bairro de teste", businessPhone: "", latitude: 0, longitude: 0,
});
const fresh = { targetUrl: "", initialReviews: null };
assert.equal(initialReviewCount(fresh, { initialReviews: "", currentReviews: "12" }, true), 12);
assert.equal(initialReviewCount(fresh, { initialReviews: "", currentReviews: "0" }, true), 0);
assert.equal(initialReviewCount(fresh, { initialReviews: "", currentReviews: "" }, true), null);
assert.equal(initialReviewCount(fresh, { initialReviews: "", currentReviews: "12" }, false), null);
assert.equal(initialReviewCount({ targetUrl: link, initialReviews: null }, { initialReviews: "", currentReviews: "12" }, true), null);
assert.equal(initialReviewCount({ targetUrl: link, initialReviews: 0 }, { initialReviews: "0", currentReviews: "12" }, true), 0);
assert.equal(initialReviewCount(fresh, { initialReviews: "7", currentReviews: "12" }, true), 7);

assert.equal(shouldAutoLocate({ targetUrl: "", latitude: null, longitude: null }), true);
assert.equal(shouldAutoLocate({ targetUrl: "", latitude: 0, longitude: 0 }), false);
assert.equal(shouldAutoLocate({ targetUrl: link, latitude: null, longitude: null }), false);
assert.equal(shouldAutoLocate({ targetUrl: link, latitude: 0, longitude: 0 }), false);
console.log(JSON.stringify({ passed: true, checks: ["device calendar in opposite timezones", "midnight recalculation before save", "manual and existing dates preserved", "unknown reviews stay null", "manual baseline includes zero only on first association", "manual fields and existing coordinates retained", "automatic GPS only for an empty unlocated plate"] }));
