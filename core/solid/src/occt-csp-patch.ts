import { createHash } from "node:crypto";

/**
 * FASE 4 · ETAPA 5 — F-05: o glue do Emscripten do occt-wasm 5.17.1 (`dist/occt-wasm.js`) gera código com
 * `new Function(...)` em dois lugares do embind:
 *   1. `createJsInvoker` — o invocador de CADA função/método C++ ligado (executa na inicialização do módulo);
 *   2. `__emval_create_invoker` — o chamador de métodos JS a partir do C++ (`emscripten::val`).
 * A CSP do app (`script-src 'self' 'wasm-unsafe-eval'`, sem `'unsafe-eval'`) proíbe isso. O motor só iniciava porque o
 * Tauri 2.12.5 não manda CSP para o script do worker.
 *
 * Esta transformação (aplicada no BUILD pelo Vite — app e worker — e pelos testes) troca os dois geradores por
 * fábricas de closures com o MESMO comportamento: é o que o próprio Emscripten emite com `-sDYNAMIC_EXECUTION=0`,
 * escrito para esta versão do glue. O `.wasm` (LGPL) não muda. Não usa eval, `Function` nem strings de código.
 *
 * Proteções: o glue de entrada precisa ter exatamente o SHA-256 conhecido (outra versão do occt-wasm → o build
 * para e pede revisão), cada trecho substituído precisa existir uma única vez, e a saída não pode conter
 * `Function(` nem `eval(`.
 */
export const OCCT_GLUE_SHA256 = "bee2d10b00b461bc4e8c693b68bdaaabfdc7f6c10efd08d4c47715732da45160"; // occt-wasm 5.17.1

/* ------------------------------------------------------------------ 1. invocador do embind
 * Original (gera, para cada assinatura, o texto):
 *   return function (arg0..argN-1) {
 *     [var destructors = [];]
 *     [var thisWired = toClassParamWire(dtorStack, this);]
 *     var argIWired = toArgIWire(dtorStack, argI); ...
 *     [var rv = ] invoker(fn, [thisWired,] arg0Wired, ...);
 *     runDestructors(destructors)  |  <param>_dtor(<param>) para cada parâmetro com destructorFunction !== null
 *     [var ret = fromRetWire(rv); return ret;]
 *   }
 * e o compila com new Function(args1, corpo). args1 = humanName, throwBindingError, invoker, fn, runDestructors,
 * fromRetWire, toClassParamWire, toArg0Wire.., <param>_dtor.. (nesta ordem — a mesma de closureArgs em
 * craftInvokerFunction). A fábrica abaixo recebe os mesmos argumentos e devolve a mesma função. */
const INVOKER_ORIG_START = "function createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync){";
const INVOKER_ORIG_END = 'invokerFnBody+="}\\n";return new Function(args1,invokerFnBody)}';
const INVOKER_NEW =
  "function createJsInvoker(argTypes,isClassMethodFunc,returns,isAsync){" +
  "/* AGTN F-05: invocador por closure, sem gerar codigo (equivalente ao DYNAMIC_EXECUTION=0 do Emscripten) */" +
  "var needsDestructorStack=usesDestructorStack(argTypes);var argCount=argTypes.length-2;var dtorParams=[];" +
  "if(!needsDestructorStack){for(var i=isClassMethodFunc?1:2;i<argTypes.length;++i){if(argTypes[i].destructorFunction!==null){dtorParams.push(i)}}}" +
  "return function(humanName,throwBindingError,invoker,fn,runDestructors,fromRetWire,toClassParamWire){" +
  "var toArgWire=Array.prototype.slice.call(arguments,7,7+argCount);" +
  "var dtors=Array.prototype.slice.call(arguments,7+argCount,7+argCount+dtorParams.length);" +
  "var invokerFn=function(){" +
  "var destructors=needsDestructorStack?[]:null;var wired=new Array(1+(isClassMethodFunc?1:0)+argCount);var w=0;wired[w++]=fn;var thisWired;" +
  "if(isClassMethodFunc){thisWired=toClassParamWire(destructors,this);wired[w++]=thisWired}" +
  "var argsWired=new Array(argCount);for(var j=0;j<argCount;++j){argsWired[j]=toArgWire[j](destructors,arguments[j]);wired[w++]=argsWired[j]}" +
  "var rv=invoker.apply(undefined,wired);" +
  "if(needsDestructorStack){runDestructors(destructors)}else{for(var k=0;k<dtorParams.length;++k){var p=dtorParams[k];dtors[k](p===1?thisWired:argsWired[p-2])}}" +
  "if(returns){var ret=fromRetWire(rv);return ret}};" +
  'Object.defineProperty(invokerFn,"length",{value:argCount});return invokerFn}}';

/* ------------------------------------------------------------------ 2. chamador de métodos JS (emval)
 * Original: monta "return function (handle, methodName, destructorsRef, args) { [return emval_returnValue(
 * toReturnWire, destructorsRef, ] <chamada>(argFromPtr0(args), argFromPtr1(args+8), ...) [)] }" e compila. <chamada>:
 * kind 0 = toValue(handle)(…); 1 = toValue(handle)[getStringOrSymbol(methodName)](…); 2 = new (toValue(handle))(…);
 * 3 = só a lista entre parênteses (operador vírgula → o último argumento). Ordem de avaliação mantida: primeiro o
 * alvo/método, depois os argumentos, depois a chamada. */
const EMVAL_ORIG =
  'var captures={toValue:Emval.toValue};var args=argFromPtr.map((argFromPtr,i)=>{var captureName=`argFromPtr${i}`;captures[captureName]=argFromPtr;return`${captureName}(args${i?"+"+i*GenericWireTypeSize:""})`});var functionBody;switch(kind){case 0:functionBody="toValue(handle)";break;case 2:functionBody="new (toValue(handle))";break;case 3:functionBody="";break;case 1:captures["getStringOrSymbol"]=getStringOrSymbol;functionBody="toValue(handle)[getStringOrSymbol(methodName)]";break}functionBody+=`(${args})`;if(!retType.isVoid){captures["toReturnWire"]=toReturnWire;captures["emval_returnValue"]=emval_returnValue;functionBody=`return emval_returnValue(toReturnWire, destructorsRef, ${functionBody})`}functionBody=`return function (handle, methodName, destructorsRef, args) {\\n${functionBody}\\n}`;var invokerFunction=new Function(Object.keys(captures),functionBody)(...Object.values(captures));';
const EMVAL_NEW =
  "/* AGTN F-05: chamador por closure, sem gerar codigo */var toValue=Emval.toValue;var nArgs=argFromPtr.length;var isVoid=!!retType.isVoid;" +
  'if(kind===3&&nArgs===0){throw new SyntaxError("emval: invocador sem argumentos")}' +
  "if(kind!==0&&kind!==1&&kind!==2&&kind!==3){throw new SyntaxError(\"emval: tipo de invocador desconhecido \"+kind)}" +
  "var invokerFunction=function(handle,methodName,destructorsRef,args){var target,self,a,r;" +
  "if(kind===1){self=toValue(handle);target=self[getStringOrSymbol(methodName)]}else if(kind!==3){target=toValue(handle)}" +
  "a=new Array(nArgs);for(var i=0;i<nArgs;++i){a[i]=argFromPtr[i](i?args+i*GenericWireTypeSize:args)}" +
  "if(kind===0){r=Reflect.apply(target,undefined,a)}else if(kind===1){r=Reflect.apply(target,self,a)}else if(kind===2){r=Reflect.construct(target,a)}else{r=a[nArgs-1]}" +
  "if(!isVoid){return emval_returnValue(toReturnWire,destructorsRef,r)}};";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const once = (code: string, needle: string, what: string) => {
  const i = code.indexOf(needle);
  if (i < 0 || code.indexOf(needle, i + 1) >= 0) throw new Error(`occt-csp-patch: trecho "${what}" não encontrado exatamente uma vez — revisar a correção F-05 para esta versão do occt-wasm.`);
  return i;
};

/** Padrões que indicam geração de código a partir de texto (o que a CSP sem 'unsafe-eval' proíbe). */
export const DYNAMIC_CODE_PATTERNS: readonly RegExp[] = [/(?<![\w$.])Function\s*\(/, /new\s+Function\b/, /(?<![\w$.])eval\s*\(/, /set(?:Timeout|Interval)\(\s*["'`]/];
export const findDynamicCode = (code: string) => DYNAMIC_CODE_PATTERNS.filter((p) => p.test(code)).map((p) => p.source);

/**
 * Aplica a correção F-05 ao glue original. Lança erro (e o build para) se o glue não for o esperado.
 * Não depende do outro ajuste do plugin (referência ao .wasm), que continua sendo feito à parte.
 */
export function patchOcctGlue(code: string): string {
  const h = sha(code);
  if (h !== OCCT_GLUE_SHA256)
    throw new Error(`occt-csp-patch: occt-wasm.js com SHA-256 ${h}, esperado ${OCCT_GLUE_SHA256} (occt-wasm 5.17.1). Atualização do motor exige revisar a correção F-05.`);
  const a = once(code, INVOKER_ORIG_START, "createJsInvoker");
  const b = once(code, INVOKER_ORIG_END, "fim de createJsInvoker");
  if (b < a) throw new Error("occt-csp-patch: createJsInvoker fora de ordem");
  let out = code.slice(0, a) + INVOKER_NEW + code.slice(b + INVOKER_ORIG_END.length);
  const e = once(out, EMVAL_ORIG, "__emval_create_invoker");
  out = out.slice(0, e) + EMVAL_NEW + out.slice(e + EMVAL_ORIG.length);
  const left = findDynamicCode(out);
  if (left.length) throw new Error(`occt-csp-patch: ainda há geração de código no glue: ${left.join(", ")}`);
  return out;
}
