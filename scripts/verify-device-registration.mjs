import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const source = await readFile(new URL("../app/dashboard.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("dashboard.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "Dashboard");
const declarations = component.body.statements;
const location = declarations.find(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(item => item.name.getText(ast) === "useMyLocation"));
const autoEffect = declarations.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useEffect" && node.getText(ast).includes("shouldAutoLocate(modal.loja)"));
const save = declarations.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "saveStore");
assert.ok(location && autoEffect && save);
assert.equal(source.includes('"/api/links/profile"'), false);
assert.equal(source.includes("googlePlacesConfigured"), false);
const compile = value => ts.transpileModule(value, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const createSession = new Function("options", `
  let locating=false, locationError="", formError="", lastRun=Promise.resolve(), geoCalls=0, reverseCalls=0, geoRequest, reverseRequest;
  let crm={address:"",neighborhood:"",currentReviews:"12"};
  const crmRef={current:crm}, manualEditsRef={current:new Set()}, locationRef={current:{latitude:null,longitude:null,source:null}};
  const locationVersionRef={current:0}, locationRequestRef={current:null}, locationPendingRef={current:false}, savingRef={current:false};
  const timers=new Map();let timerId=0;
  const window={setTimeout(fn,delay){const id=++timerId;timers.set(id,{fn,delay});return id},clearTimeout(id){timers.delete(id)}};
  const navigator=options.unsupported?{}:{geolocation:{getCurrentPosition(resolve,reject,requestOptions){geoCalls++;geoRequest={resolve,reject,requestOptions}}}};
  const setLocating=value=>{locating=value},setLocationError=value=>{locationError=value},setFormError=value=>{formError=value};
  const setFormLocation=value=>{locationRef.current=value},setCrm=value=>{crm=value};
  const api=async(url,request)=>{assertLocalEndpoint(url);reverseCalls++;return await new Promise((resolve,reject)=>{reverseRequest={resolve,reject};request.signal.addEventListener("abort",()=>reject(request.signal.reason),{once:true})})};
  function assertLocalEndpoint(url){if(url!=="/api/location/reverse")throw new Error("Unexpected endpoint")}
  const useCallback=callback=>(...args)=>{const wasPending=locationPendingRef.current;const run=callback(...args);if(!wasPending)lastRun=run;return run};
  let modal={kind:"store",loja:options.loja||{targetUrl:"",latitude:null,longitude:null}};
  const shouldAutoLocate=loja=>!loja.targetUrl.trim()&&loja.latitude==null&&loja.longitude==null;
  const saving=false;
  ${compile(location.getText(ast))}
  ${compile(save.getText(ast))}
  const auto=()=>{${compile(autoEffect.expression.arguments[0].body.getText(ast).slice(1,-1))}};
  return {
    auto,useMyLocation,saveStore,
    flush(delay){for(const[id,timer]of[...timers])if(timer.delay===delay){timers.delete(id);timer.fn()}},
    succeed(){geoRequest.resolve({coords:{latitude:0,longitude:0}})},deny(){geoRequest.reject({code:1})},
    reverseSuccess(){reverseRequest.resolve({address:"Endereço de teste",neighborhood:"Bairro de teste"})},reverseFail(){reverseRequest.reject(new Error("Preencha o endereço manualmente."))},
    edit(field,value){manualEditsRef.current.add(field);crmRef.current={...crmRef.current,[field]:value};crm=crmRef.current},
    close(){locationVersionRef.current++;locationRequestRef.current?.abort();locationPendingRef.current=false;modal=null},
    settle(){return lastRun},get state(){return{locating,locationError,formError,location:locationRef.current,crm:crmRef.current,pending:locationPendingRef.current,geoCalls,reverseCalls,requestOptions:geoRequest?.requestOptions}}
  };
`);

const session = createSession({});
const cleanup = session.auto();
assert.equal(session.state.geoCalls, 0, "GPS must wait until after the modal has mounted");
cleanup(); session.auto(); session.flush(0);
assert.equal(session.state.geoCalls, 1, "An effect cleanup/remount must not issue a duplicate permission request");
assert.equal(session.state.locating, true);
assert.equal(session.state.requestOptions.maximumAge, 0);
await session.useMyLocation();
assert.equal(session.state.geoCalls, 1, "Do not overlap GPS requests");
await session.saveStore({ preventDefault() {} });
assert.match(session.state.formError, /Aguarde/);
session.succeed(); await Promise.resolve(); await Promise.resolve();
session.edit("address", "Endereço digitado"); session.edit("neighborhood", "");
session.reverseSuccess(); await session.settle();
assert.equal(session.state.locating, false);
assert.equal(session.state.crm.address, "Endereço digitado");
assert.equal(session.state.crm.neighborhood, "", "Reverse lookup must respect a deliberate manual clear");
assert.equal(session.state.crm.currentReviews, "12", "GPS must never change review counts");
assert.deepEqual(session.state.location, { latitude: 0, longitude: 0, source: "gps" });

const denied = createSession({}); denied.auto(); denied.flush(0); denied.deny(); await denied.settle();
assert.equal(denied.state.pending, false); assert.equal(denied.state.locating, false);
assert.match(denied.state.locationError, /negada.*manualmente/);
assert.equal(denied.state.reverseCalls, 0);
const unsupported = createSession({ unsupported: true }); unsupported.auto(); unsupported.flush(0); await unsupported.settle();
assert.equal(unsupported.state.locating, false); assert.match(unsupported.state.locationError, /manualmente/);

const stale = createSession({}); stale.auto(); stale.flush(0); stale.close(); stale.succeed(); await stale.settle();
assert.equal(stale.state.reverseCalls, 0); assert.deepEqual(stale.state.location, { latitude: null, longitude: null, source: null });
const slow = createSession({}); slow.auto(); slow.flush(0); slow.flush(25_000); await slow.settle(); slow.succeed(); await Promise.resolve();
assert.equal(slow.state.locating, false); assert.equal(slow.state.reverseCalls, 0); assert.match(slow.state.locationError, /demorou/);
const noAddress = createSession({}); noAddress.auto(); noAddress.flush(0); noAddress.succeed(); await Promise.resolve(); await Promise.resolve(); noAddress.reverseFail(); await noAddress.settle();
assert.equal(noAddress.state.locating, false); assert.deepEqual(noAddress.state.location, { latitude: 0, longitude: 0, source: "gps" });

for (const loja of [{ targetUrl: "https://g.page/r/existing/review", latitude: null, longitude: null }, { targetUrl: "", latitude: 0, longitude: 0 }]) {
  const existing = createSession({ loja }); existing.auto(); existing.flush(0); assert.equal(existing.state.geoCalls, 0);
}
console.log(JSON.stringify({ passed: true, checks: ["GPS starts after modal cleanup", "one permission request at a time", "save waits for GPS", "manual fields preserved", "denied and unsupported fallback", "closed modal and timeout discard stale results", "GPS retained if address lookup fails", "existing associations and coordinates never auto-locate", "no Google profile calls"] }));
