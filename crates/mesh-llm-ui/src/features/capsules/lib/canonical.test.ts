import { describe, expect, it } from 'vitest'
import { digestResponseBody, formatRustFloat, jcsValue } from './canonical'

// [mesh-disclosure-recompute-jcs-float] The disclosure panel's recompute-and-
// match silently degraded to "could not verify" on any real llama.cpp
// response, because the browser JCS threw on the non-integer floats in a
// `timings` block. These tests pin the fix's mutants.

describe('formatRustFloat', () => {
  // Reference values captured directly from `serde_json::Number::to_string()`
  // (the mesh-llm host's actual float formatter, via `openai_exchange::
  // jcs_value`) -- NOT RFC 8785 SS3.2.2.3's ECMAScript algorithm, which the
  // two diverge from in verified ways (see canonical.ts's module note).
  const cases: Array<[number, string]> = [
    [123.45, '123.45'],
    [43.0, '43.0'],
    [0.1, '0.1'],
    [1e10, '10000000000.0'],
    [1.5e-10, '1.5e-10'],
    [100.0, '100.0'],
    [-0.0, '-0.0'],
    [3.14159265358979, '3.14159265358979'],
    [1234567890123.456, '1234567890123.456'],
    [2.0, '2.0'],
    [0.0001, '0.0001'],
    [1.0e21, '1e+21'],
    [5.960464477539064e-8, '5.960464477539064e-8'],
    [1e-6, '1e-6'],
    [9.999999e-7, '9.999999e-7'],
    [1e-7, '1e-7'],
    [1e20, '1e+20'],
    [9.99e20, '9.99e+20'],
    [2e-8, '2e-8'],
    [1e-5, '0.00001'],
    [1e15, '1000000000000000.0'],
    [1e16, '1e+16'],
    [1e17, '1e+17'],
    [1.23456e17, '1.23456e+17'],
    [9.99999e16, '9.99999e+16'],
    [1.2e-5, '0.000012'],
    [9.999e-6, '9.999e-6'],
    [123456789012345.0, '123456789012345.0'],
    [1234567890123456.0, '1234567890123456.0'],
    [1.23456e-5, '0.0000123456'],
    [9.87654e-6, '9.87654e-6'],
    [1234567890123450.0, '1234567890123450.0'],
    [9876543210987650.0, '9876543210987650.0'],
    [0.0, '0.0'],
    [-123.456, '-123.456'],
    [-1e-10, '-1e-10'],
    [-1e20, '-1e+20'],
    [2.2250738585072014e-308, '2.2250738585072014e-308'],
    [5e-324, '5e-324'],
    [20.0, '20.0'],
    [1234.5, '1234.5'],
    [0.30000000000000004, '0.30000000000000004']
  ]

  it.each(cases)('formats %j as %j', (input, expected) => {
    expect(formatRustFloat(input)).toBe(expected)
  })

  it('formats a value beyond safe-integer precision via its actual double bits', () => {
    // Written as Number(...) rather than a literal so the (intentional)
    // precision loss doesn't trip eslint's no-loss-of-precision rule.
    expect(formatRustFloat(Number('12345678901234567.0'))).toBe('1.2345678901234568e+16')
  })

  it('rejects NaN and Infinity rather than coercing a digest (mutant 4)', () => {
    expect(() => formatRustFloat(NaN)).toThrow()
    expect(() => formatRustFloat(Infinity)).toThrow()
    expect(() => formatRustFloat(-Infinity)).toThrow()
  })
})

describe('digestResponseBody', () => {
  // Identical literal JSON text to `openai_exchange.rs`'s
  // `LLAMA_CPP_TIMINGS_FIXTURE` -- keep the two in sync character-for-
  // character if either changes.
  const LLAMA_CPP_TIMINGS_FIXTURE =
    '{"id":"chatcmpl-mesh-1","object":"chat.completion","created":1700000000,"model":"llama-3.2-3b-instruct",' +
    '"choices":[{"index":0,"message":{"role":"assistant","content":"hi there"},"finish_reason":"stop"}],' +
    '"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15},' +
    '"timings":{"prompt_n":10,"prompt_ms":123.456,"prompt_per_token_ms":12.3456,"prompt_per_second":81.0,' +
    '"predicted_n":5,"predicted_ms":234.567,"predicted_per_token_ms":46.9134,"predicted_per_second":21.3169}}'

  // The exact hex the Rust seal path produces for LLAMA_CPP_TIMINGS_FIXTURE --
  // see `openai_exchange.rs::response_digest_over_real_llama_cpp_timings_floats`.
  const EXPECTED_TIMINGS_DIGEST = '7179feb00c2b4e2a99a785449eb202c2faf9694cc77501876802c300f57b298a'

  it('matches the Rust seal path digest for a real llama.cpp timings body (mutant 1)', async () => {
    const preimage = `{"response_body":${LLAMA_CPP_TIMINGS_FIXTURE}}`
    await expect(digestResponseBody(preimage)).resolves.toBe(EXPECTED_TIMINGS_DIGEST)
  })

  it('a whole-number float (prompt_per_second: 81.0) is NOT collapsed to an integer', async () => {
    // If the lexical-form distinction were lost, this would silently digest
    // as though the source had written `81`, not `81.0`, and mismatch the
    // pinned digest above (already covered), but assert the mechanism
    // directly too: changing 81.0 -> 81 in the source text must change the
    // digest.
    const withBareInt = LLAMA_CPP_TIMINGS_FIXTURE.replace('"prompt_per_second":81.0', '"prompt_per_second":81')
    const preimage = `{"response_body":${withBareInt}}`
    const computed = await digestResponseBody(preimage)
    expect(computed).not.toBe(EXPECTED_TIMINGS_DIGEST)
  })

  it('a tampered response_body (one byte changed, floats intact) mismatches (mutant 2)', async () => {
    const tampered = LLAMA_CPP_TIMINGS_FIXTURE.replace('"hi there"', '"hi there!"')
    const preimage = `{"response_body":${tampered}}`
    const computed = await digestResponseBody(preimage)
    expect(computed).not.toBe(EXPECTED_TIMINGS_DIGEST)
  })

  it('still matches for an integer-only response body -- no regression (mutant 3)', async () => {
    // Identical literal JSON text to `openai_exchange.rs`'s
    // `response_digest_over_integer_only_body_unchanged` fixture.
    const integerOnlyBody =
      '{"id":"x","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant",' +
      '"content":"hello"},"finish_reason":"stop"}],"usage":{"prompt_tokens":2,"completion_tokens":1,"total_tokens":3}}'
    const preimage = `{"response_body":${integerOnlyBody}}`
    await expect(digestResponseBody(preimage)).resolves.toBe(
      '660e8a56afa6b1cdf4b088c0c42be7f6af958b28492b7583d6676a684dbe5bd7'
    )
  })

  it('throws rather than silently degrading when response_body is absent', async () => {
    await expect(digestResponseBody('{"request_body":{"a":1}}')).rejects.toThrow()
  })
})

describe('jcsValue (strict AAC capsule form, unaffected by this fix)', () => {
  it('still rejects a float in a digest-bearing capsule field', () => {
    expect(() => jcsValue({ a: 1.5 })).toThrow()
  })

  it('still accepts safe integers', () => {
    expect(jcsValue({ b: 1, a: 2 })).toBe('{"a":2,"b":1}')
  })
})
