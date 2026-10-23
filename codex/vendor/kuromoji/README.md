# Kuromoji.js (vendored)

Version: 0.1.2. Upstream: https://github.com/takuyaa/kuromoji.js

The browser build and the complete compressed IPADIC dictionary are copied,
unmodified, from the published npm package:
https://registry.npmjs.org/kuromoji/-/kuromoji-0.1.2.tgz

Verified archive SHA-1: `293f0d6706df006112137980588d5daac26d0790`.
Registry integrity (SHA-512):
`V0dUf+C2LpcPEXhoHLMAop/bOht16Dyr+mDiIE39yX3vqau7p80De/koFqpiTcL1zzdZlc3xuHZ8u5gjYRfFaQ==`.

`kuromoji.js` is the upstream Browserify build (307,967 bytes).
`dict/` contains the 12 upstream `.dat.gz` files, about 21.8 MB in total.
Serve them as files; do not configure `.gz` files with an extra gzip content
encoding because the library decompresses their payload itself.

Keep `LICENSE-2.0.txt` and `NOTICE.md` with these files. The latter includes
the IPADIC copyright and redistribution notices. No package installation or
CDN is needed by players. Dictionary requests stay on the quiz's origin;
conversion of recognized text to readings runs in the browser.
