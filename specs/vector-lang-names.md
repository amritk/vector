---
title: "vector/lang/names — naming a contract's functions in each language"
abbrev: vector/lang/names
docname: draft-vector-lang-names-00
category: info
ipr: trust200902
submissiontype: independent
v: 3
date: 2026-11-13
author:
  - name: Vector Authors
    org: vector
--- abstract

Module: src/lang/names.ts (vector/lang/names), vector's own. A contract names
its functions, parameters and module once, as the spec writes them; a test
emitted in another language must call them by the names that language's
style standard gives them. This spec pins down those name rules for each
language vector knows. vector checks itself with this spec: its test is
emitted into tests/dogfood/ and runs with npm test.

This spec leaves three things out. It does not cover the word list
langWords returns, or a contract's per-language name overrides, because a
contract has no type for a list of strings or of overrides; tests/lang/
holds both. Its names are ASCII only, because a string domain in a spec can
hold only printable ASCII.

--- middle

# Introduction

{::boilerplate bcp14-tagged}

The expected names in the vectors below are the golden names vector's
TypeScript implementation gave every function of three contracts in every
language (tests/fixtures/languages/expected.json); the port to Nish must
give the same.

# Interface

~~~ ts-interface
// module: vector/lang/names
export const langName = (lang: string, contractName: string, isFunction: boolean): string
export const langModule = (lang: string, module: string): string
export const langQualify = (lang: string, module: string, name: string): string
~~~

# Words {#words}

A name MUST be split into words at each underscore, at each step from a
lowercase letter or digit to a capital, and before the last capital of a run
of two or more capitals that a lowercase letter follows; a run of digits MUST
stay with the word before it, and every letter MUST be kept.
{: #R-WORDS}

~~~ ts-property
// P-WORDS-KEEP-LETTERS covers R-WORDS — a name of letters loses none of them
forall (n: string /* 1..24 alpha */) => {
  const lower = n.toLowerCase();
  return langName("java", n, true).toLowerCase() === lower && langName("go", n, true).toLowerCase() === lower && langName("csharp", n, true).toLowerCase() === lower && langName("swift", n, false).toLowerCase() === lower;
}
~~~

# Names

## snake_case {#snake}

For rust, ruby, cpp, c and python, and for zig's parameters, langName MUST
return the words in lowercase, joined by underscores.
{: #R-SNAKE}

~~~ ts-property
// P-SNAKE-LOWER covers R-SNAKE — a snake_case name has no capital
forall (n: string /* 1..24 "abcXYZ_09" */) => {
  const s = langName("python", n, true);
  return s === s.toLowerCase();
}
~~~

~~~ ts-property
// P-SNAKE-AGREE covers R-SNAKE — every snake_case language names a function and a parameter alike
forall (n: string /* 1..24 "abcXYZ_09" */) => {
  const s = langName("python", n, true);
  return langName("rust", n, false) === s && langName("ruby", n, true) === s && langName("cpp", n, false) === s && langName("c", n, true) === s && langName("zig", n, false) === s;
}
~~~

## camelCase {#camel}

For java and typescript, and for zig's functions, langName MUST return the
first word in lowercase and each later word with its first letter in
capitals and the rest in lowercase.
{: #R-CAMEL}

~~~ ts-property
// P-CAMEL-FIRST covers R-CAMEL — a camelCase name starts in lowercase
forall (n: string /* 1..24 alpha */) => {
  const j = langName("java", n, true);
  const c = j.charAt(0);
  return c === c.toLowerCase() && langName("typescript", n, false) === j && langName("zig", n, true) === j;
}
~~~

## Short capitals {#short-caps}

For kotlin and dart, langName MUST write names as java does, except that a
later word of exactly two capitals MUST stay in capitals.
{: #R-SHORT-CAPS}

~~~ ts-property
// P-SHORT-CAPS-AGREE covers R-SHORT-CAPS — Kotlin and Dart name a function and a parameter alike
forall (n: string /* 1..24 "abcXYZ_09" */) => langName("kotlin", n, true) === langName("dart", n, false)
~~~

## As written {#as-written}

For php and swift, langName MUST return the first word in lowercase and each
later word with its first letter in capitals and the rest as written.
{: #R-AS-WRITTEN}

~~~ ts-property
// P-AS-WRITTEN-AGREE covers R-AS-WRITTEN — PHP and Swift name a function and a parameter alike
forall (n: string /* 1..24 "abcXYZ_09" */) => langName("php", n, true) === langName("swift", n, false)
~~~

## C# {#csharp}

For csharp, langName MUST name a parameter as kotlin does, and a function
the same way but with its first word's first letter in capitals.
{: #R-CSHARP}

~~~ ts-property
// P-CSHARP covers R-CSHARP — a C# method is PascalCase, a parameter is Kotlin's camelCase
forall (n: string /* 1..24 alpha */) => {
  const f = langName("csharp", n, true);
  const c = f.charAt(0);
  return c === c.toUpperCase() && langName("csharp", n, false) === langName("kotlin", n, false);
}
~~~

## Go {#go}

For go, langName MUST write a function's first word with its first letter in
capitals, so that it is exported, and a parameter's first word in lowercase;
any other word that is an acronym or one of golint's initialisms MUST be
written in capitals.
{: #R-GO}

~~~ ts-property
// P-GO-EXPORTED covers R-GO — a Go function is exported
forall (n: string /* 1..24 alpha */) => {
  const g = langName("go", n, true);
  const c = g.charAt(0);
  return c === c.toUpperCase();
}
~~~

## Other languages {#unknown}

For a language vector does not know, langName and langModule MUST return the
name and the module unchanged.
{: #R-UNKNOWN}

~~~ ts-property
// P-UNKNOWN covers R-UNKNOWN — an unknown language changes nothing
forall (n: string /* 1..24 "abcXYZ_09/" */) => langName("cobol", n, true) === n && langModule("cobol", n) === n
~~~

# Modules

## Module paths {#module-paths}

langModule MUST write a contract's module path (segments joined by `/`) the
way its language names a module: a crate path for rust and cpp, a constant
path for ruby, a source file for zig, a header for c, a namespace for csharp
and php, a package and class for java and kotlin, a dotted module for
python, a module name for swift and a package library for dart.
{: #R-MODULE}

~~~ ts-property
// P-MODULE-FILES covers R-MODULE — Zig and C name a module by its file
forall (m: string /* 1..24 "abc_/" */) => langModule("zig", m) === m + ".zig" && langModule("c", m) === m + ".h"
~~~

## Qualified names {#qualify}

langQualify MUST write a name as its language calls it from outside its
module.
{: #R-QUALIFY}

~~~ ts-property
// P-QUALIFY-DOT covers R-QUALIFY — the dotted languages put a dot between the module and the name
forall (m: string /* 1..16 "abcAB." */, n: string /* 1..16 alpha */) => langQualify("java", m, n) === m + "." + n && langQualify("python", m, n) === m + "." + n && langQualify("rust", m, n) === m + "::" + n
~~~

~~~ ts-property
// P-QUALIFY-PHP covers R-QUALIFY — PHP calls a static method from the global namespace
forall (m: string /* 1..16 "abcAB" */, n: string /* 1..16 alpha */) => langQualify("php", m, n) === "\\" + m + "::" + n
~~~

# Security Considerations

A wrong name makes an emitted test call a function that does not exist,
which fails to build rather than passing; it cannot make a wrong
implementation pass.

# Test Vectors

| Id | Call | Expected | Covers | Source | Title |
|----|------|----------|--------|--------|-------|
| V1 | `langName("python", "parseHTTPRequest", true)` | `"parse_http_request"` | R-WORDS, R-SNAKE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["python"]["parseHTTPRequest"]["function"])'` | a run of capitals ends before the capital that starts the next word |
| V2 | `langName("rust", "x25519_publicKey", false)` | `"x25519_public_key"` | R-WORDS, R-SNAKE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["rust"]["x25519_publicKey"]["param"])'` | an underscore splits, and digits stay with their word |
| V3 | `langName("c", "utf8Decode", true)` | `"utf8_decode"` | R-WORDS, R-SNAKE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["c"]["utf8Decode"]["function"])'` | a digit does not start a word |
| V4 | `langName("zig", "readIOStream", true)` | `"readIoStream"` | R-WORDS, R-CAMEL | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["zig"]["readIOStream"]["function"])'` | Zig functions are camelCase, every later word capitalized |
| V5 | `langName("zig", "readIOStream", false)` | `"read_io_stream"` | R-SNAKE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["zig"]["readIOStream"]["param"])'` | Zig parameters are snake_case |
| V6 | `langName("java", "parseHTTPRequest", true)` | `"parseHttpRequest"` | R-CAMEL | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["java"]["parseHTTPRequest"]["function"])'` | Java writes an acronym as a word |
| V7 | `langName("typescript", "x25519_publicKey", false)` | `"x25519PublicKey"` | R-WORDS, R-CAMEL | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["typescript"]["x25519_publicKey"]["param"])'` | TypeScript joins the words an underscore split |
| V8 | `langName("kotlin", "readIOStream", true)` | `"readIOStream"` | R-SHORT-CAPS | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["kotlin"]["readIOStream"]["function"])'` | Kotlin keeps a two-letter acronym in capitals |
| V9 | `langName("dart", "parseHTTPRequest", false)` | `"parseHttpRequest"` | R-SHORT-CAPS | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["dart"]["parseHTTPRequest"]["param"])'` | Dart capitalizes a longer acronym as a word |
| V10 | `langName("csharp", "readIOStream", true)` | `"ReadIOStream"` | R-CSHARP, R-SHORT-CAPS | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["csharp"]["readIOStream"]["function"])'` | a C# method is PascalCase and keeps a two-letter acronym |
| V11 | `langName("csharp", "parseHTTPRequest", false)` | `"parseHttpRequest"` | R-CSHARP, R-SHORT-CAPS | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["csharp"]["parseHTTPRequest"]["param"])'` | a C# parameter is camelCase |
| V12 | `langName("go", "userId", true)` | `"UserID"` | R-GO | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["go"]["userId"]["function"])'` | Go exports a function and writes golint's ID initialism in capitals |
| V13 | `langName("go", "utf8Decode", false)` | `"utf8Decode"` | R-GO | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["go"]["utf8Decode"]["param"])'` | a Go parameter is unexported, its first word in lowercase |
| V14 | `langName("go", "parseHTTPRequest", true)` | `"ParseHTTPRequest"` | R-GO | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["go"]["parseHTTPRequest"]["function"])'` | Go keeps an acronym in capitals |
| V15 | `langName("swift", "parseHTTPRequest", true)` | `"parseHTTPRequest"` | R-AS-WRITTEN | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["swift"]["parseHTTPRequest"]["function"])'` | Swift keeps every word's letters as written |
| V16 | `langName("php", "userId", false)` | `"userId"` | R-AS-WRITTEN | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["rules"]["php"]["userId"]["param"])'` | PHP keeps every word's letters as written |
| V17 | `langModule("rust", "nish/crypto/hkdf")` | `"nish::crypto::hkdf"` | R-MODULE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["rust"]["module"])'` | a Rust crate path |
| V18 | `langModule("ruby", "nish/crypto/hkdf")` | `"Nish::Crypto::Hkdf"` | R-MODULE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["ruby"]["module"])'` | a Ruby constant path |
| V19 | `langModule("csharp", "nish/crypto/hkdf")` | `"Nish.Crypto.Hkdf"` | R-MODULE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["csharp"]["module"])'` | a C# namespace |
| V20 | `langModule("java", "nish/crypto/hkdf")` | `"nish.crypto.Hkdf"` | R-MODULE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["java"]["module"])'` | a Java package and class |
| V21 | `langModule("python", "nish/crypto/hkdf")` | `"nish.crypto.hkdf"` | R-MODULE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["python"]["module"])'` | a Python dotted module |
| V22 | `langModule("php", "nish/crypto/hkdf")` | `"Nish\\Crypto\\Hkdf"` | R-MODULE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["php"]["module"])'` | a PHP namespace |
| V23 | `langModule("swift", "nish/crypto/hkdf")` | `"NishCryptoHkdf"` | R-MODULE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["swift"]["module"])'` | a Swift module name |
| V24 | `langModule("dart", "nish/crypto/hkdf")` | `"package:nish/crypto/hkdf.dart"` | R-MODULE | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["dart"]["module"])'` | a Dart package library |
| V25 | `langQualify("rust", "nish::crypto::hkdf", "hkdf_extract_sha256")` | `"nish::crypto::hkdf::hkdf_extract_sha256"` | R-QUALIFY | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["rust"]["functions"]["hkdfExtractSha256"]["qualified"])'` | Rust qualifies with :: |
| V26 | `langQualify("c", "nish/crypto/hkdf.h", "hkdf_extract_sha256")` | `"nish_crypto_hkdf_hkdf_extract_sha256"` | R-QUALIFY | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["c"]["functions"]["hkdfExtractSha256"]["qualified"])'` | C prefixes the header path |
| V27 | `langQualify("go", "nish/crypto/hkdf", "HkdfExtractSha256")` | `"hkdf.HkdfExtractSha256"` | R-QUALIFY | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["go"]["functions"]["hkdfExtractSha256"]["qualified"])'` | Go qualifies by the package's last segment |
| V28 | `langQualify("dart", "package:nish/crypto/hkdf.dart", "hkdfExtractSha256")` | `"hkdf.hkdfExtractSha256"` | R-QUALIFY | `python3 -c 'import json; print(json.load(open("../tests/fixtures/languages/expected.json"))["contracts"]["rfc5869-hkdf-sha256"]["dart"]["functions"]["hkdfExtractSha256"]["qualified"])'` | Dart qualifies by the library's file name |
