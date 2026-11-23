# Changelog

## [0.6.1](https://github.com/amritk/vector/compare/v0.6.0...v0.6.1) (2026-11-23)


### Bug Fixes

* **spec:** refuse an unknown call after one only a later ts-interface block declares ([#210](https://github.com/amritk/vector/issues/210)) ([e6b4b97](https://github.com/amritk/vector/commit/e6b4b975663273a562f7a8c7df7787300859a4ed))

## [0.6.0](https://github.com/amritk/vector/compare/v0.5.0...v0.6.0) (2026-11-20)


### Features

* **spec:** allow a hyphen inside a module path segment ([#184](https://github.com/amritk/vector/issues/184)) ([ce3e55c](https://github.com/amritk/vector/commit/ce3e55cd982c46f3d6da7ceb49cffeeed01605ab))
* **spec:** build and read integers as bytes of every width and both byte orders ([#188](https://github.com/amritk/vector/issues/188)) ([691cd1b](https://github.com/amritk/vector/commit/691cd1b664aaaffa952d5bd2e0529b4c26fd86a1))
* **spec:** build mutants from the root's seed with its std/ laid over it ([#192](https://github.com/amritk/vector/issues/192)) ([ea51dda](https://github.com/amritk/vector/commit/ea51dda0e7e8c370ce2a286e7e83f610b1db6e37))
* **spec:** count the kramdown-rfc reference cache as spec side in frozen ([#178](https://github.com/amritk/vector/issues/178)) ([14a6a2d](https://github.com/amritk/vector/commit/14a6a2d5bbb2ccc2cd3a5ef07781242b81674199))
* **spec:** declare a (buf, off, len) window as one bytes parameter ([#185](https://github.com/amritk/vector/issues/185)) ([1161fbd](https://github.com/amritk/vector/commit/1161fbd248fc5008f93e04568adab3673a483867))
* **spec:** declare an (out, at) -&gt; end write as a bytes result ([#191](https://github.com/amritk/vector/issues/191)) ([7fca9a4](https://github.com/amritk/vector/commit/7fca9a4bef15c64d11ffbbb29fef2edcf34ab815))
* **spec:** let a command source print an integer, bool or null, and drive Secret parameters from a property ([#194](https://github.com/amritk/vector/issues/194)) ([511a237](https://github.com/amritk/vector/commit/511a237655fc86971c4570a18c871323940868e0))
* **spec:** let frozen accept one PR that only renames a contracted export ([#186](https://github.com/amritk/vector/issues/186)) ([01c7ab1](https://github.com/amritk/vector/commit/01c7ab124337e5b54ff3a3f0553f2c1605c00252))
* **spec:** mutate only the code a contract tests ([#182](https://github.com/amritk/vector/issues/182)) ([07e3257](https://github.com/amritk/vector/commit/07e3257cf8569279d1e2bafc41ac3af0fe69415f))
* **spec:** pair values under RFC case headings ([#198](https://github.com/amritk/vector/issues/198)) ([6a9c603](https://github.com/amritk/vector/commit/6a9c60349080f4c3ab74fc77b80d72be79a15733))
* **spec:** read v3 plain-text RFCs and drop break hints in RFC sources ([#183](https://github.com/amritk/vector/issues/183)) ([b9ac2fa](https://github.com/amritk/vector/commit/b9ac2fa0e72939512cde6955a0369d1b8c98897f))
* **spec:** read values named across wrapped lines ([#189](https://github.com/amritk/vector/issues/189)) ([756ed44](https://github.com/amritk/vector/commit/756ed4443a91ac63cbd23a8f3be36443535f2951))
* **verify:** say why a witness did not replay in --json ([#207](https://github.com/amritk/vector/issues/207)) ([a3dc8d1](https://github.com/amritk/vector/commit/a3dc8d11a7297910385e1830d59f04b20496a139))


### Bug Fixes

* **ci:** carry a doc cap across a rename and check caps on push to main ([#205](https://github.com/amritk/vector/issues/205)) ([893bd6c](https://github.com/amritk/vector/commit/893bd6c89825989ca19f1a90023480527763cfd9))
* **spec:** check a main-RFC spec's command rows against the spec's own section ([#180](https://github.com/amritk/vector/issues/180)) ([52b330e](https://github.com/amritk/vector/commit/52b330e7c036c9f6aae74548fa8452bee2796eeb))
* **spec:** count an anchored RFC quote as its requirement in the spec's own text ([#179](https://github.com/amritk/vector/issues/179)) ([58692a0](https://github.com/amritk/vector/commit/58692a0dc83d14e255053515b4726466b8fd3da7))
* **spec:** end a sentence at every block of the spec's own text ([#187](https://github.com/amritk/vector/issues/187)) ([0ab7e4f](https://github.com/amritk/vector/commit/0ab7e4f8313fb01507e36901d2ee91fef2aecc42))
* **spec:** name the hyphen rule when a ts-interface module line is not a module path ([#202](https://github.com/amritk/vector/issues/202)) ([d61be70](https://github.com/amritk/vector/commit/d61be70eed17647493145ec48ff52eb1d2941009))
* **spec:** place the unprinted-count refusal at its Iterate paragraph ([#157](https://github.com/amritk/vector/issues/157)) ([b3f2bba](https://github.com/amritk/vector/commit/b3f2bba7e15e0142733105ba67e6d0da90b98c84)), closes [#151](https://github.com/amritk/vector/issues/151)
* **spec:** refuse a symlinked std/ in spec mutate --nish slots ([#206](https://github.com/amritk/vector/issues/206)) ([b0c0e3f](https://github.com/amritk/vector/commit/b0c0e3f42a6a7680cbe11e4250d5a9ece1c7c978))
* **spec:** report a missing or duplicated ts-interface block first, without its cascade ([#203](https://github.com/amritk/vector/issues/203)) ([ed33f44](https://github.com/amritk/vector/commit/ed33f446fd68dad64e0f47c4309262152465397b))
* **spec:** report a refused ts-interface module line first, without its cascade ([#181](https://github.com/amritk/vector/issues/181)) ([8c45f7f](https://github.com/amritk/vector/commit/8c45f7f3a39f08406d6033428a027651eff286bc))
* **spec:** sort extract refusals in XML document order ([#169](https://github.com/amritk/vector/issues/169)) ([ea66e1c](https://github.com/amritk/vector/commit/ea66e1c6bc3adf37c84774ada4fe4997950cad2b))
* **verify:** name the callers whose call a guard is not proven at ([#166](https://github.com/amritk/vector/issues/166)) ([230cf32](https://github.com/amritk/vector/commit/230cf3208a6d58916a432da2c9d79445fe13b564)), closes [#162](https://github.com/amritk/vector/issues/162)

## [0.5.0](https://github.com/amritk/vector/compare/v0.4.0...v0.5.0) (2026-11-17)


### Features

* **ci:** cap the size of agent-facing docs ([#143](https://github.com/amritk/vector/issues/143)) ([472f030](https://github.com/amritk/vector/commit/472f030150a5a823cb8b4f96424f75fa58c2c15f))
* **cli:** name docs/AI.md from an Agents section in --help ([#145](https://github.com/amritk/vector/issues/145)) ([e232b05](https://github.com/amritk/vector/commit/e232b05a46d586da4471c5522b1c8e3f9dc5b8f7))
* **spec:** close the iterated-vectors follow-ups from [#117](https://github.com/amritk/vector/issues/117) ([#134](https://github.com/amritk/vector/issues/134)) ([247629d](https://github.com/amritk/vector/commit/247629d40f67ec86ecec30943ffd811d6f1f11d6))
* **verify:** replay every counterexample exactly and report MISMATCH ([#146](https://github.com/amritk/vector/issues/146)) ([045dca3](https://github.com/amritk/vector/commit/045dca3e91a546cd45e6de2d292e633724a7b6d9))


### Bug Fixes

* **spec:** refuse a property that restates the row it derives ([#144](https://github.com/amritk/vector/issues/144)) ([d23aa05](https://github.com/amritk/vector/commit/d23aa054a908da73e61141d4796c19e6538b9e4f))
* **spec:** report a refusal's own markdown line, or none ([#148](https://github.com/amritk/vector/issues/148)) ([6f68c42](https://github.com/amritk/vector/commit/6f68c427fdaeedc390c41a06afa0a1df1726d6b5))

## [0.4.0](https://github.com/amritk/vector/compare/v0.3.1...v0.4.0) (2026-11-17)


### Features

* **spec:** add u16[], u32[] and u64[] word arrays to contracts ([#131](https://github.com/amritk/vector/issues/131)) ([f9be4fb](https://github.com/amritk/vector/commit/f9be4fbb8e132cdc222eb772d1bc224e126d1401))
* **spec:** cite a vector's stated result to a second RFC section ([#133](https://github.com/amritk/vector/issues/133)) ([ca00f28](https://github.com/amritk/vector/commit/ca00f2813458e472c1a9d101e87ffdaa817316c0))
* **spec:** hold a truncated result to a vector row with a Truncate paragraph ([#130](https://github.com/amritk/vector/issues/130)) ([293f44a](https://github.com/amritk/vector/commit/293f44afd8ad5daecc9b87bf6a524b6a4d5eed1a))
* **spec:** let a label hold an apostrophe, a comma alias and a group with a comma ([#127](https://github.com/amritk/vector/issues/127)) ([869d875](https://github.com/amritk/vector/commit/869d8753a5bf5e68890c730d43e96737b8d5d93d))
* **spec:** scope a vector row's labels to an in-section Test Vector #N ([#129](https://github.com/amritk/vector/issues/129)) ([ae1e7ed](https://github.com/amritk/vector/commit/ae1e7ed97af5f4e2d282dfa7a6bc81d11976676e))


### Bug Fixes

* **spec:** classify generated tests by every contract in spec frozen ([#126](https://github.com/amritk/vector/issues/126)) ([4672a7b](https://github.com/amritk/vector/commit/4672a7b2ab8ef08b8f63a42afcd59bf1fecd17e4))

## [0.3.1](https://github.com/amritk/vector/compare/v0.3.0...v0.3.1) (2026-11-16)


### Bug Fixes

* **release:** name the repository in package.json, which npm provenance checks ([4e5ca9b](https://github.com/amritk/vector/commit/4e5ca9bf3eff7e6cd3df38db8ab57731bdbf65e1))
* **release:** name the repository in package.json, which npm provenance checks ([a6c9c32](https://github.com/amritk/vector/commit/a6c9c3278c9a08f9be569f1eaa7d30ddf257d732))

## [0.3.0](https://github.com/amritk/vector/compare/v0.2.1...v0.3.0) (2026-11-16)


### Features

* **spec:** a spec can declare outOfScope exports ([#109](https://github.com/amritk/vector/issues/109)) ([9730c7b](https://github.com/amritk/vector/commit/9730c7b58d61c35252ed08b9c6df205e050e2d07))
* **spec:** an Iterate paragraph after the vector table ([#112](https://github.com/amritk/vector/issues/112)) ([784f4bc](https://github.com/amritk/vector/commit/784f4bc958b2d1749c0a43e82da873494cf9cfbd))
* **spec:** an iterated vector in the contract, checked by shape, typing and fidelity ([#110](https://github.com/amritk/vector/issues/110)) ([bca06eb](https://github.com/amritk/vector/commit/bca06eb7e11283aa648d21ba33ae8785c3819b1a))
* **spec:** emitted tests run an iterated vector, slow ones on --slow ([#114](https://github.com/amritk/vector/issues/114)) ([060d360](https://github.com/amritk/vector/commit/060d36055a10d0cfbdb49c10968a9e408b5a8050))
* **spec:** labels with parentheses, and values printed as (length 0 bytes) ([#113](https://github.com/amritk/vector/issues/113)) ([11a6b20](https://github.com/amritk/vector/commit/11a6b2081976f425cb747fac01b8d56dfff0ddef))
* **spec:** let a ts-property block set its sample count ([#106](https://github.com/amritk/vector/issues/106)) ([5123175](https://github.com/amritk/vector/commit/5123175f1358abf4de56aef581bec4c5c0eae4ca))

## [0.2.1](https://github.com/amritk/vector/compare/v0.2.0...v0.2.1) (2026-11-16)


### Chores

* release 0.2.1 ([aec6696](https://github.com/amritk/vector/commit/aec66964fa4da6a50ff412bb10256f0533355a00))

## [0.2.0](https://github.com/amritk/vector/compare/v0.1.0...v0.2.0) (2026-11-16)


### Features

* **verify:** prove Int arithmetic stays exact in float64 ([#96](https://github.com/amritk/vector/issues/96)) ([3fc2a6a](https://github.com/amritk/vector/commit/3fc2a6a1f67544f8ca7c7defbb0bc2f81a71d101))
