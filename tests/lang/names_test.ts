import { Suite } from "nish/testing"
import { newJsonDocument, readJsonFile } from "../../src/core/json"
import {
  LangCase,
  langBasename,
  langCamel,
  langCapitalize,
  langGoInitialisms,
  langIsAcronym,
  langModule,
  langModuleIn,
  langName,
  langNameIn,
  langPackageClass,
  langPascal,
  langPascalSegment,
  langQualify,
  langSnake,
  langWords,
} from "../../src/lang/names"
import { contractLoadFile } from "../../src/spec/contract/contract"
import { NameOverride } from "../../src/spec/contract/types"
import { vocabLanguages } from "../../src/spec/contract/vocab"

const FIXTURE: string = "tests/fixtures/languages/expected.json"

/** The fixture's names for every function of contract `id`, rebuilt from the rules, as JSON text. */
const namesRebuilt = (id: string): string => {
  const doc = newJsonDocument()
  const c = contractLoadFile(`contracts/${id}.json`).expect("load")
  const all = doc.newObject()
  for (const lang of vocabLanguages()) {
    const entry = doc.newObject()
    const module = langModuleIn(lang, c.target.module, c.target.modules)
    doc.set(entry, "module", doc.newString(module))
    const fns = doc.newObject()
    for (const f of c.functions) {
      const o = doc.newObject()
      const name = langNameIn(lang, f.name, true, f.names)
      doc.set(o, "name", doc.newString(name))
      const fm = f.module
      const m = fm === null ? module : langModule(lang, fm)
      if (fm !== null) {
        doc.set(o, "module", doc.newString(m))
      }
      doc.set(o, "qualified", doc.newString(langQualify(lang, m, name)))
      const ps = doc.newObject()
      for (const p of f.params) {
        doc.set(ps, p.name, doc.newString(langNameIn(lang, p.name, false, p.names)))
      }
      doc.set(o, "params", ps)
      doc.set(fns, f.name, o)
    }
    doc.set(entry, "functions", fns)
    doc.set(all, lang, entry)
  }
  return doc.stringify(all)
}

/** The fixture's entry for contract `id`, as JSON text. */
const namesExpected = (id: string): string => {
  const doc = newJsonDocument()
  const root = readJsonFile(doc, FIXTURE).expect("fixture")
  return doc.stringify(doc.get(doc.get(root, "contracts"), id))
}

/** Checks the word split, the casings, and every language's name and module rules. */
export const main = (): i32 => {
  const t = new Suite("lang/names")

  t.eqStr("hkdfExpandSha256", langWords("hkdfExpandSha256").join(","), "hkdf,Expand,Sha256")
  t.eqStr("chacha20Poly1305Seal", langWords("chacha20Poly1305Seal").join(","), "chacha20,Poly1305,Seal")
  t.eqStr("parseHTTPRequest", langWords("parseHTTPRequest").join(","), "parse,HTTP,Request")
  t.eqStr("readIOStream", langWords("readIOStream").join(","), "read,IO,Stream")
  t.eqStr("HTTP", langWords("HTTP").join(","), "HTTP")
  t.eqStr("utf8Decode", langWords("utf8Decode").join(","), "utf8,Decode")
  t.eqStr("x25519_publicKey", langWords("x25519_publicKey").join(","), "x25519,public,Key")
  t.eqStr("sha256Sha256", langWords("sha256Sha256").join(","), "sha256,Sha256")
  t.eqStr("b64", langWords("b64").join(","), "b64")
  t.eqStr("_x", langWords("_x").join(","), "x")
  t.eqStr("a digit run after _ starts a word", langWords("a_1b").join(","), "a,1,b")
  t.eqStr("a capital before a digit", langWords("getA1").join(","), "get,A1")
  t.eqStr("no name, no words", `${langWords("").length}`, "0")

  t.ok("HTTP is an acronym", langIsAcronym("HTTP"))
  t.ok("UTF8 is an acronym", langIsAcronym("UTF8"))
  t.ok("Http is not", !langIsAcronym("Http"))
  t.ok("one capital is not", !langIsAcronym("A"))
  t.eqStr("capitalize", langCapitalize("hTTP"), "Http")
  t.eqStr("snake", langSnake("parseHTTPRequest"), "parse_http_request")
  t.eqStr("camel by word", langCamel("ParseHTTPRequest", LangCase.Word), "parseHttpRequest")
  t.eqStr("camel by short caps", langCamel("readIOStream", LangCase.ShortCaps), "readIOStream")
  t.eqStr("pascal as written", langPascal("parseHTTPRequest", LangCase.AsWritten), "ParseHTTPRequest")
  t.eqStr("pascal segment", langPascalSegment("big_int"), "BigInt")
  t.eqStr("basename", langBasename("package:nish/crypto/hkdf.dart"), "hkdf")
  t.eqStr("basename keeps a non-extension", langBasename("a/b.C"), "b.C")
  t.eqStr("package class", langPackageClass("nish/crypto/hkdf"), "nish.crypto.Hkdf")
  t.ok("ID is a Go initialism", langGoInitialisms().indexOf("ID") >= 0)
  t.ok("HKDF is not", langGoInitialisms().indexOf("HKDF") < 0)
  t.eqStr("a one-segment Dart module is its package's library", langModule("dart", "nish"), "package:nish/nish.dart")
  t.eqStr("an unknown language keeps the name", langName("cobol", "hkdfExpand", true), "hkdfExpand")
  t.eqStr("and the module", langModule("cobol", "nish/hex"), "nish/hex")

  const doc = newJsonDocument()
  const root = readJsonFile(doc, FIXTURE).expect("fixture")
  const rules = doc.get(root, "rules")
  for (let i = 0; i < doc.length(rules); i++) {
    const lang = doc.keyAt(rules, i)
    const names = doc.at(rules, i)
    for (let j = 0; j < doc.length(names); j++) {
      const n = doc.keyAt(names, j)
      const want = doc.at(names, j)
      t.eqStr(`${lang} function ${n}`, langName(lang, n, true), doc.string(doc.get(want, "function")))
      t.eqStr(`${lang} param ${n}`, langName(lang, n, false), doc.string(doc.get(want, "param")))
    }
  }
  t.eqStr("the fixture has every language's rules", `${doc.length(rules)}`, `${vocabLanguages().length}`)

  for (const id of ["example-hex", "rfc5869-hkdf-sha256", "rfc8439-chacha20-poly1305"]) {
    t.eqStr(`every function of ${id}, named in every language`, namesRebuilt(id), namesExpected(id))
  }

  const mine = [new NameOverride("go", "Expand")]
  for (const lang of vocabLanguages()) {
    const want = lang === "go" ? "Expand" : langName(lang, "hkdfExpandSha256", true)
    t.eqStr(`${lang}: an override for go`, langNameIn(lang, "hkdfExpandSha256", true, mine), want)
    const wantModule = lang === "go" ? "Expand" : langModule(lang, "nish/crypto/hkdf")
    t.eqStr(`${lang}: a module override for go`, langModuleIn(lang, "nish/crypto/hkdf", mine), wantModule)
    t.eqStr(`${lang}: no overrides`, langNameIn(lang, "x", false, null), langName(lang, "x", false))
  }
  return t.done()
}
