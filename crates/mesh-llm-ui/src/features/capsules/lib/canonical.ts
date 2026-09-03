// Hand port of agent_action_capsule/canonical.py's vintage format-2
// construction (mirrors capsule-emit-mesh's mesh_viewer_static/mesh_verify.js
// byte-for-byte): drop {capsule_id, chain, signature, key_id}, absent-field
// normalize (remove null / empty-array / empty-object members, bottom-up),
// then RFC 8785 JCS, then SHA-256. Must stay in step with the Rust plugin's
// jcs.rs and the Python reference -- this is the third independent port of
// the same digest.

const LOCAL_ONLY = ['signature', 'key_id']
const CHAIN_LINKAGE = ['capsule_id', 'chain']
const MAX_SAFE = 9007199254740991 // 2^53 - 1

export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

function normalize(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(normalize)
  if (value !== null && typeof value === 'object') {
    const out: { [key: string]: JsonValue } = {}
    for (const key of Object.keys(value)) {
      const nv = normalize(value[key])
      if (nv === null || nv === undefined) continue
      if (Array.isArray(nv) && nv.length === 0) continue
      if (!Array.isArray(nv) && typeof nv === 'object' && Object.keys(nv).length === 0) continue
      out[key] = nv
    }
    return out
  }
  return value === undefined ? null : value
}

function jcsString(s: string): string {
  const out: string[] = ['"']
  for (let i = 0; i < s.length; i++) {
    const ch = s.charAt(i)
    const code = s.charCodeAt(i)
    if (ch === '"') out.push('\\"')
    else if (ch === '\\') out.push('\\\\')
    else if (code === 0x08) out.push('\\b')
    else if (code === 0x09) out.push('\\t')
    else if (code === 0x0a) out.push('\\n')
    else if (code === 0x0c) out.push('\\f')
    else if (code === 0x0d) out.push('\\r')
    else if (code < 0x20) out.push('\\u' + code.toString(16).padStart(4, '0'))
    else out.push(ch)
  }
  out.push('"')
  return out.join('')
}

export function jcsValue(v: JsonValue): string {
  if (v === null || v === undefined) return 'null'
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (typeof v === 'string') return jcsString(v)
  if (typeof v === 'number') {
    if (!Number.isInteger(v)) throw new Error(`non-integer number in digest-bearing field: ${v}`)
    if (v > MAX_SAFE || v < -MAX_SAFE) throw new Error(`integer outside JS-safe range: ${v}`)
    return String(v)
  }
  if (Array.isArray(v)) return '[' + v.map(jcsValue).join(',') + ']'
  if (typeof v === 'object') {
    const keys = Object.keys(v).sort()
    return '{' + keys.map((k) => jcsString(k) + ':' + jcsValue(v[k])).join(',') + '}'
  }
  throw new Error('unserializable value')
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s)
}

// --- response-body plain-JCS (mesh-disclosure-recompute-jcs-float) --------
//
// `response_digest` is NOT computed by the strict AAC capsule form above
// (`jcsValue`/`normalize`, which correctly REJECTS floats -- see
// agent-action-capsule spec S:5.1). It is computed by the mesh-llm host's
// `openai_exchange::jcs_value` over the served response body AS-IS: no
// absent-field normalization, and numbers serialized via plain
// `serde_json::Number::to_string()` (Rust's `ryu`-based shortest-round-trip
// formatter), not RFC 8785 SS3.2.2.3's ECMAScript algorithm. The two disagree
// in real, verified ways (`ryu` always appends `.0` to a whole-number float
// and switches to exponential notation at different magnitude thresholds
// than V8's `Number.prototype.toString()`), so a plain `String(v)` here would
// false-red a real disclosed body, and the strict `jcsValue` throws on any
// float at all. `formatRustFloat`/`jcsPlainValue` below reproduce the host's
// exact algorithm (thresholds/mantissa rules verified empirically against
// `serde_json` -- see the task notes) so the browser's recompute matches the
// sealing side byte-for-byte.
//
// A second, independent problem: `JSON.parse` collapses `43.0` and `43` to
// the identical JS number 43, but serde_json's Number is `Float` or
// `PosInt`/`NegInt` depending on whether the SOURCE TEXT had a `.`/`e`/`E` --
// a whole-number float (e.g. `"predicted_ms": 0.0`, plausible when zero
// tokens were predicted) would digest as `0` in-browser but `0.0` on the
// sealing side. `parsePreservingNumberForm` below is a small hand-rolled JSON
// parser that keeps that lexical distinction so `jcsPlainValue` can pick the
// same branch serde_json did.

/** RFC-8785-shaped float formatting matching Rust's `ryu`-based
 * `serde_json::Number::to_string()`. NOT the same as RFC 8785 SS3.2.2.3's
 * ECMAScript algorithm -- see the module note above for why this
 * intentionally diverges from spec-pure JCS. */
export function formatRustFloat(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`non-finite number in digest-bearing field: ${v}`)
  const sign = v < 0 || Object.is(v, -0) ? '-' : ''
  const exp = Math.abs(v).toExponential()
  const eIdx = exp.indexOf('e')
  const digits = exp.slice(0, eIdx).replace('.', '')
  const e = parseInt(exp.slice(eIdx + 1), 10)
  if (e >= -5 && e <= 15) {
    if (e >= 0) {
      return (
        sign +
        (e + 1 >= digits.length
          ? digits + '0'.repeat(e + 1 - digits.length) + '.0'
          : digits.slice(0, e + 1) + '.' + digits.slice(e + 1))
      )
    }
    return sign + '0.' + '0'.repeat(-e - 1) + digits
  }
  const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits
  return `${sign}${mantissa}e${e >= 0 ? '+' : '-'}${Math.abs(e)}`
}

type RawNumber = { readonly raw: true; readonly text: string; readonly isFloat: boolean }
type ParsedJson = null | boolean | string | RawNumber | ParsedJson[] | { [key: string]: ParsedJson }

function isRawNumber(v: unknown): v is RawNumber {
  return typeof v === 'object' && v !== null && (v as { raw?: unknown }).raw === true
}

/** JSON parser that tags each number with whether its source token contained
 * `.`/`e`/`E` -- the same signal serde_json uses to pick `Number::Float` vs
 * `Number::PosInt`/`NegInt`. See the module note above. */
function parsePreservingNumberForm(text: string): ParsedJson {
  let i = 0
  const len = text.length

  function fail(msg: string): never {
    throw new Error(`disclosure preimage parse error: ${msg} at position ${i}`)
  }

  function skipWs() {
    while (i < len && (text[i] === ' ' || text[i] === '\t' || text[i] === '\n' || text[i] === '\r')) i++
  }

  function expectLiteral(lit: string) {
    if (text.slice(i, i + lit.length) !== lit) fail(`expected '${lit}'`)
    i += lit.length
  }

  function parseValue(): ParsedJson {
    skipWs()
    const ch = text[i]
    if (ch === '{') return parseObject()
    if (ch === '[') return parseArray()
    if (ch === '"') return parseString()
    if (ch === 't') {
      expectLiteral('true')
      return true
    }
    if (ch === 'f') {
      expectLiteral('false')
      return false
    }
    if (ch === 'n') {
      expectLiteral('null')
      return null
    }
    if (ch === '-' || (ch >= '0' && ch <= '9')) return parseNumber()
    fail(`unexpected character '${ch}'`)
  }

  function parseObject(): { [key: string]: ParsedJson } {
    i++ // '{'
    const out: { [key: string]: ParsedJson } = {}
    skipWs()
    if (text[i] === '}') {
      i++
      return out
    }
    for (;;) {
      skipWs()
      if (text[i] !== '"') fail('expected string key')
      const key = parseString()
      skipWs()
      if (text[i] !== ':') fail("expected ':'")
      i++
      out[key] = parseValue()
      skipWs()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === '}') {
        i++
        break
      }
      fail("expected ',' or '}'")
    }
    return out
  }

  function parseArray(): ParsedJson[] {
    i++ // '['
    const out: ParsedJson[] = []
    skipWs()
    if (text[i] === ']') {
      i++
      return out
    }
    for (;;) {
      out.push(parseValue())
      skipWs()
      if (text[i] === ',') {
        i++
        continue
      }
      if (text[i] === ']') {
        i++
        break
      }
      fail("expected ',' or ']'")
    }
    return out
  }

  function parseString(): string {
    i++ // opening '"'
    let out = ''
    for (;;) {
      const ch = text[i]
      if (ch === undefined) fail('unterminated string')
      if (ch === '"') {
        i++
        break
      }
      if (ch === '\\') {
        const esc = text[i + 1]
        if (esc === '"' || esc === '\\' || esc === '/') {
          out += esc
          i += 2
        } else if (esc === 'b') {
          out += '\b'
          i += 2
        } else if (esc === 'f') {
          out += '\f'
          i += 2
        } else if (esc === 'n') {
          out += '\n'
          i += 2
        } else if (esc === 'r') {
          out += '\r'
          i += 2
        } else if (esc === 't') {
          out += '\t'
          i += 2
        } else if (esc === 'u') {
          const hex = text.slice(i + 2, i + 6)
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) fail('bad \\u escape')
          out += String.fromCharCode(parseInt(hex, 16))
          i += 6
        } else {
          fail('bad escape')
        }
      } else {
        out += ch
        i++
      }
    }
    return out
  }

  function parseNumber(): RawNumber {
    const start = i
    if (text[i] === '-') i++
    if (text[i] === '0') i++
    else {
      if (!(text[i] >= '1' && text[i] <= '9')) fail('invalid number')
      while (text[i] >= '0' && text[i] <= '9') i++
    }
    let isFloat = false
    if (text[i] === '.') {
      isFloat = true
      i++
      if (!(text[i] >= '0' && text[i] <= '9')) fail('invalid number')
      while (text[i] >= '0' && text[i] <= '9') i++
    }
    if (text[i] === 'e' || text[i] === 'E') {
      isFloat = true
      i++
      if (text[i] === '+' || text[i] === '-') i++
      if (!(text[i] >= '0' && text[i] <= '9')) fail('invalid number')
      while (text[i] >= '0' && text[i] <= '9') i++
    }
    return { raw: true, text: text.slice(start, i), isFloat }
  }

  const result = parseValue()
  skipWs()
  if (i !== len) fail('unexpected trailing content')
  return result
}

/** Plain JCS (sorted keys, no absent-field normalization) with numbers
 * serialized to match the mesh-llm host's `openai_exchange::jcs_value`
 * exactly: an integer echoes its own source token (already the canonical
 * decimal form -- JSON forbids leading zeros/`+`), a float goes through
 * `formatRustFloat`. Distinct from `jcsValue` above, which implements the
 * strict AAC capsule form that REJECTS floats -- the two canonicalizers are
 * legitimately different on the wire and must stay so. */
export function jcsPlainValue(v: ParsedJson): string {
  if (v === null) return 'null'
  if (v === true) return 'true'
  if (v === false) return 'false'
  if (typeof v === 'string') return jcsString(v)
  if (isRawNumber(v)) return v.isFloat ? formatRustFloat(Number(v.text)) : v.text
  if (Array.isArray(v)) return '[' + v.map(jcsPlainValue).join(',') + ']'
  const keys = Object.keys(v).sort()
  return '{' + keys.map((k) => jcsString(k) + ':' + jcsPlainValue(v[k])).join(',') + '}'
}

/** JSON-DIGEST of a disclosed `response_body`, computed the way the mesh-llm
 * host computes `response_digest`: plain JCS over the response AS SERVED (no
 * normalize, floats formatted like `ryu`), not the strict capsule form.
 * Takes the disclosure preimage's raw JSON TEXT (not an already-`JSON.parse`d
 * object) so a whole-number float field doesn't lose its lexical form -- see
 * the module note above. */
export async function digestResponseBody(rawPreimageText: string): Promise<string> {
  const parsed = parsePreservingNumberForm(rawPreimageText)
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed) || isRawNumber(parsed)) {
    throw new Error('disclosure preimage is not a JSON object')
  }
  const responseBody = parsed.response_body
  if (responseBody === undefined) throw new Error('disclosure preimage has no response_body')
  return sha256Hex(utf8Bytes(jcsPlainValue(responseBody)))
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', bytes as BufferSource)
  const arr = new Uint8Array(buf)
  let hex = ''
  for (let i = 0; i < arr.length; i++) hex += arr[i].toString(16).padStart(2, '0')
  return hex
}

/** Recompute a mesh capsule's `capsule_id` in-browser (the vintage format-2 construction). */
export async function recomputeCapsuleId(record: Record<string, unknown>): Promise<string> {
  if (Object.prototype.hasOwnProperty.call(record, 'canonicalization_id')) {
    const excl4 = { capsule_id: 1, signature: 1, key_id: 1 } as Record<string, 1>
    const c4: Record<string, JsonValue> = {}
    for (const k of Object.keys(record)) if (!excl4[k]) c4[k] = record[k] as JsonValue
    return sha256Hex(utf8Bytes(jcsValue(c4)))
  }
  const excluded: Record<string, 1> = {}
  for (const k of [...CHAIN_LINKAGE, ...LOCAL_ONLY]) excluded[k] = 1
  const canonical: Record<string, JsonValue> = {}
  for (const k of Object.keys(record)) if (!excluded[k]) canonical[k] = record[k] as JsonValue
  return sha256Hex(utf8Bytes(jcsValue(normalize(canonical))))
}

/** The canonical JSON-DIGEST (JCS + SHA-256) of an object whose digest-bearing
 * values are strings/integers only -- the served-terminal-facts shape. */
export async function digestFacts(obj: JsonValue): Promise<string> {
  return sha256Hex(utf8Bytes(jcsValue(obj)))
}
