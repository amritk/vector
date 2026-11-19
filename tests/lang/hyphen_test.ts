import { Suite } from "nish/testing"
import {
  langModule,
  langName,
  langPackageClass,
  langPascalSegment,
  langQualify,
  langUnderscored,
} from "../../src/lang/names"
import { vocabLanguages } from "../../src/spec/contract/vocab"

/**
 * Each language's module and qualified name for two hyphenated modules, the
 * function `quic_varint_size`: a path or file keeps a `-`, an identifier
 * segment turns it into `_`, Go's package qualifier drops it, a Pascal form
 * starts a word at it.
 */
const langHyphenForms = (): string[][] => [
  ["rust", "nish/net/quic-packet", "nish::net::quic_packet", "nish::net::quic_packet::quic_varint_size"],
  ["rust", "nish-x/net-io/http1-codec", "nish_x::net_io::http1_codec", "nish_x::net_io::http1_codec::quic_varint_size"],
  ["ruby", "nish/net/quic-packet", "Nish::Net::QuicPacket", "Nish::Net::QuicPacket.quic_varint_size"],
  ["ruby", "nish-x/net-io/http1-codec", "NishX::NetIo::Http1Codec", "NishX::NetIo::Http1Codec.quic_varint_size"],
  ["zig", "nish/net/quic-packet", "nish/net/quic-packet.zig", "quic_packet.quicVarintSize"],
  ["zig", "nish-x/net-io/http1-codec", "nish-x/net-io/http1-codec.zig", "http1_codec.quicVarintSize"],
  ["go", "nish/net/quic-packet", "nish/net/quic-packet", "quicpacket.QuicVarintSize"],
  ["go", "nish-x/net-io/http1-codec", "nish-x/net-io/http1-codec", "http1codec.QuicVarintSize"],
  ["cpp", "nish/net/quic-packet", "nish::net::quic_packet", "nish::net::quic_packet::quic_varint_size"],
  ["cpp", "nish-x/net-io/http1-codec", "nish_x::net_io::http1_codec", "nish_x::net_io::http1_codec::quic_varint_size"],
  ["csharp", "nish/net/quic-packet", "Nish.Net.QuicPacket", "Nish.Net.QuicPacket.QuicVarintSize"],
  ["csharp", "nish-x/net-io/http1-codec", "NishX.NetIo.Http1Codec", "NishX.NetIo.Http1Codec.QuicVarintSize"],
  ["c", "nish/net/quic-packet", "nish/net/quic-packet.h", "nish_net_quic_packet_quic_varint_size"],
  ["c", "nish-x/net-io/http1-codec", "nish-x/net-io/http1-codec.h", "nish_x_net_io_http1_codec_quic_varint_size"],
  ["java", "nish/net/quic-packet", "nish.net.QuicPacket", "nish.net.QuicPacket.quicVarintSize"],
  ["java", "nish-x/net-io/http1-codec", "nish_x.net_io.Http1Codec", "nish_x.net_io.Http1Codec.quicVarintSize"],
  ["kotlin", "nish/net/quic-packet", "nish.net.QuicPacket", "nish.net.QuicPacket.quicVarintSize"],
  ["kotlin", "nish-x/net-io/http1-codec", "nish_x.net_io.Http1Codec", "nish_x.net_io.Http1Codec.quicVarintSize"],
  ["python", "nish/net/quic-packet", "nish.net.quic_packet", "nish.net.quic_packet.quic_varint_size"],
  ["python", "nish-x/net-io/http1-codec", "nish_x.net_io.http1_codec", "nish_x.net_io.http1_codec.quic_varint_size"],
  ["typescript", "nish/net/quic-packet", "nish/net/quic-packet", "quic_packet.quicVarintSize"],
  ["typescript", "nish-x/net-io/http1-codec", "nish-x/net-io/http1-codec", "http1_codec.quicVarintSize"],
  ["php", "nish/net/quic-packet", "Nish\\Net\\QuicPacket", "\\Nish\\Net\\QuicPacket::quicVarintSize"],
  ["php", "nish-x/net-io/http1-codec", "NishX\\NetIo\\Http1Codec", "\\NishX\\NetIo\\Http1Codec::quicVarintSize"],
  ["swift", "nish/net/quic-packet", "NishNetQuicPacket", "NishNetQuicPacket.quicVarintSize"],
  ["swift", "nish-x/net-io/http1-codec", "NishXNetIoHttp1Codec", "NishXNetIoHttp1Codec.quicVarintSize"],
  ["dart", "nish/net/quic-packet", "package:nish/net/quic-packet.dart", "quic_packet.quicVarintSize"],
  ["dart", "nish-x/net-io/http1-codec", "package:nish_x/net-io/http1-codec.dart", "http1_codec.quicVarintSize"],
]

/** Whether a qualified name still holds a `-`, or for Go an `_` in its package qualifier. */
const langHyphenInIdentifier = (lang: string, qualified: string): boolean =>
  qualified.indexOf("-") >= 0 || (lang === "go" && qualified.indexOf("_") >= 0)

/** The language forms of hyphenated module paths. */
export const main = (): i32 => {
  const t = new Suite("lang/hyphen")
  t.eqStr("langUnderscored", langUnderscored("nish-x/net/quic-packet"), "nish_x/net/quic_packet")
  t.eqStr("langUnderscored leaves the rest", langUnderscored("nish/a_b"), "nish/a_b")
  t.eqStr("langPascalSegment at a -", langPascalSegment("quic-packet"), "QuicPacket")
  t.eqStr("langPascalSegment at - and _", langPascalSegment("a_b-c1"), "ABC1")
  t.eqStr("langPackageClass", langPackageClass("nish/net-io/quic-packet"), "nish.net_io.QuicPacket")
  const seen: string[] = []
  for (const k of langHyphenForms()) {
    const lang = k[0]
    const module = langModule(lang, k[1])
    t.eqStr(`${lang}: module of ${k[1]}`, module, k[2])
    const q = langQualify(lang, module, langName(lang, "quic_varint_size", true))
    t.eqStr(`${lang}: qualified name in ${k[1]}`, q, k[3])
    t.eqBool(`${lang}: no - in the name of ${k[1]}`, langHyphenInIdentifier(lang, q), false)
    if (seen.indexOf(lang) < 0) {
      seen.push(lang)
    }
  }
  for (const lang of vocabLanguages()) {
    t.ok(`${lang} has hyphenated forms`, seen.indexOf(lang) >= 0)
  }
  return t.done()
}
