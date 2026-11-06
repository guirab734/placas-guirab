import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("dashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "Dashboard");
const named = (nodes, name) => nodes.find(node => (ts.isClassDeclaration(node) || ts.isFunctionDeclaration(node)) && node.name?.text === name)?.getText(ast);
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const names = ["resetLinkResolution", "openStore", "changeTarget", "resolveLink", "saveStore"];
const handlers = names.map(name => { const found = named(component.body.statements, name); assert.ok(found, `Missing handler ${name}`); return found; }).join("\n");
const apiSource = named(ast.statements, "api");
assert.equal(source.includes("profileFallback"), false, "The UI must not offer or store a profile fallback");
assert.equal(source.includes("Usar perfil do Google"), false);
const fixture = { id: "local-ui-test", code: "TEST", name: "Loja de teste", targetUrl: "", joinedAt: null, initialReviews: null, currentReviews: null, ownerName: "", ownerPhone: "", businessPhone: "", address: "", neighborhood: "", notes: "", nextContactAt: null, latitude: null, longitude: null };
const createSession = new Function("fixture", `
  let modal=null,targetUrl="",resolvedLink=null,resolveError="",resolvingLink=false,formError="",saving=false,locating=false;
  const resolveVersionRef={current:0},resolveRequestRef={current:null},resolvedLinkRef={current:null};
  const locationVersionRef={current:0},locationRequestRef={current:null},locationPendingRef={current:false},locationRef={current:{latitude:null,longitude:null,source:null}};
  const nameValueRef={current:""},crmRef={current:{}},manualEditsRef={current:new Set()},targetInputRef={current:null},initialInputRef={current:null};
  const setResolvedLink=value=>{resolvedLink=value},setResolveError=value=>{resolveError=value},setResolvingLink=value=>{resolvingLink=value};
  const setFormError=value=>{formError=value},setSaving=value=>{saving=value},setTargetUrl=value=>{targetUrl=value},setModal=value=>{modal=value},setLocating=value=>{locating=value};
  const setName=()=>{},setRecordId=()=>{},setCrm=()=>{},setLocationError=()=>{},setFormLocation=()=>{},setSelectedId=()=>{},setLojas=()=>{},notify=()=>{};
  const plateName=()=>"Placa de teste",plateLabel=()=>"Placa de teste · TEST",isAvailable=loja=>!loja.targetUrl.trim();
  const initialJoinedAt=loja=>loja.joinedAt||"",shouldAutoLocate=()=>false,initialReviewCount=()=>null,joinedAtForSave=()=>null,manualFormFields=()=>({});
  const window={setTimeout:()=>0};
  const requests=[];
  const fetch=(url,options)=>{
    const entry={url,body:options.body?JSON.parse(options.body):undefined,signal:options.signal};requests.push(entry);
    if(options.method==="PATCH")return Promise.resolve(Response.json({loja:{...fixture,...entry.body}}));
    return new Promise(resolve=>{entry.respond=(status,body)=>resolve(Response.json(body,{status}))});
  };
  ${compile(apiSource)}
  ${compile(handlers)}
  return {
    open:()=>openStore(fixture),changeTarget,resolveLink,save:()=>saveStore({preventDefault(){}}),
    close(){modal=null;resolveVersionRef.current++;resolveRequestRef.current?.controller.abort();resolveRequestRef.current=null},
    respond(index,status,body){requests[index].respond(status,body)},
    get state(){return{resolvedLink,resolveError,resolvingLink,formError,saving,targetUrl}},get requests(){return requests}
  };
`);

const short = "https://maps.app.goo.gl/example";
const profile = "https://www.google.com/maps/place/Example";
const review = "https://search.google.com/local/writereview?placeid=EXAMPLE";
const error = { error: "Não foi possível preparar o link direto.", reason: "GoogleAccessBlocked", profileFallback: { targetUrl: profile, converted: false, destinationKind: "profile" } };
const reviewResult = { targetUrl: review, converted: true, destinationKind: "review" };

const normal = createSession({ ...fixture }); normal.open(); normal.changeTarget(short);
const normalResolve = normal.resolveLink(short); normal.respond(0, 200, reviewResult); await normalResolve;
assert.equal(normal.state.resolvedLink.destinationKind, "review");
await normal.save();
assert.equal(normal.requests[1].body.targetMode, "review"); assert.equal(normal.requests[1].body.targetUrl, review);

const failedConversion = createSession({ ...fixture }); failedConversion.open(); failedConversion.changeTarget(short);
const failed = failedConversion.resolveLink(short); failedConversion.respond(0, 422, error); assert.equal(await failed, null);
assert.equal(failedConversion.state.resolvedLink, null, "Even an obsolete backend suggestion must never select the profile");
const failedSave = failedConversion.save(); failedConversion.respond(1, 422, error); await failedSave;
assert.equal(failedConversion.requests.some(request => request.url.includes("/api/lojas/")), false, "A conversion failure must block saving a new destination");
const retry = failedConversion.resolveLink(short); failedConversion.respond(2, 200, reviewResult); await retry;
await failedConversion.save(); assert.equal(failedConversion.requests[3].body.targetMode, "review");
assert.equal(failedConversion.requests[3].body.targetUrl, review);

const shared = createSession({ ...fixture }); shared.open(); shared.changeTarget(short);
const sharedFirst = shared.resolveLink(short), sharedSecond = shared.resolveLink(short);
assert.equal(shared.requests.length, 1, "Blur and Save must reuse the same in-flight conversion");
shared.respond(0, 200, reviewResult); await Promise.all([sharedFirst, sharedSecond]);
shared.changeTarget("https://maps.app.goo.gl/other");
assert.equal(shared.state.resolvedLink, null, "Changing URL must discard the old conversion");

const stale = createSession({ ...fixture }); stale.open(); stale.changeTarget(short);
const first = stale.resolveLink(short); stale.changeTarget(review);
const second = stale.resolveLink(review); stale.respond(1, 200, reviewResult); await second;
stale.respond(0, 422, error); await first;
assert.equal(stale.state.resolvedLink.sourceUrl, review); assert.equal(stale.state.resolveError, "");
const closed = createSession({ ...fixture }); closed.open(); closed.changeTarget(short);
const pending = closed.resolveLink(short); closed.close(); closed.respond(0, 422, error); await pending;
assert.equal(closed.state.resolvedLink, null, "A response arriving after modal close must not revive an old destination");

const saved = createSession({ ...fixture, targetUrl: profile }); saved.open();
assert.equal(saved.state.resolvedLink.destinationKind, "saved");
await saved.resolveLink(profile); assert.equal(saved.requests.length, 0);
saved.changeTarget(short); saved.changeTarget(profile); await saved.resolveLink(profile);
assert.equal(saved.requests.length, 0, "Returning to the unchanged saved URL must not query Google");
await saved.save(); assert.equal(saved.requests.length, 1);
assert.equal(Object.hasOwn(saved.requests[0].body, "targetUrl"), false);
assert.equal(Object.hasOwn(saved.requests[0].body, "targetMode"), false);

for (const response of [
  { status: 422, body: { ...error, profileFallback: { ...error.profileFallback, targetUrl: "javascript:alert(1)" } } },
  { status: 422, body: { ...error, profileFallback: { ...error.profileFallback, converted: true } } },
  { status: 200, body: { targetUrl: profile, converted: false, destinationKind: "profile" } },
]) {
  const invalid = createSession({ ...fixture }); invalid.open(); invalid.changeTarget(short);
  const attempt = invalid.resolveLink(short); invalid.respond(0, response.status, response.body); await attempt;
  assert.equal(invalid.state.resolvedLink, null);
}
console.log(JSON.stringify({ passed: true, checks: ["new destinations always use direct review mode", "conversion failure blocks saving instead of opening a profile", "successful retry saves the converted review", "blur and save share in-flight conversion", "URL changes discard old results", "stale and closed-modal responses ignored", "saved destinations never requery and omit target fields", "invalid backend profile destinations rejected"] }));
