# IVMS101 payload hashing

ComplyRail records a SHA-256 hash of each IVMS101 payload on-chain. The full
payload stays off-chain and is sent between VASPs. A beneficiary VASP can
check the payload it received against the on-chain hash.

## Canonical form

The hash is taken over the **RFC 8785 JSON Canonicalization Scheme (JCS)**
encoding of the payload, not over `JSON.stringify` output. JCS removes all
dependence on key order and whitespace, so any language that implements
RFC 8785 produces the same bytes. The rules:

- No insignificant whitespace.
- Object keys sorted by UTF-16 code units.
- Strings escaped as in `JSON.stringify`: `"`, `\`, and control characters
  (`\b \f \n \r \t`, and `\u00XX` with lowercase hex for the rest). All other
  characters are emitted as UTF-8.
- Numbers in ECMAScript `Number.prototype.toString` form, for example `1e+30`
  and `0.002`.

The app implements this in `canonicalJson` in `lib/contract.ts`. The hash is
`sha256(utf8(canonicalJson(payload)))`, returned as lowercase hex.

Payloads hashed before this change used `JSON.stringify` and key insertion
order. Their on-chain hashes do not match the canonical form. The attestation
is still valid; verify those older payloads with the same method they were
hashed with.

## Test vectors

### Vector 1: IVMS101 payment payload

Input (the object produced by `buildIvmsPayload` with paymentId `1`,
originator "Ada", beneficiary "Bola", amount `10`, asset `USDC`):

```json
{"ivms101Version":"IVMS101.2023","paymentId":"1","originator":{"originatorPersons":[{"naturalPerson":{"name":{"nameIdentifier":[{"primaryIdentifier":"Ada"}]}}}],"accountNumber":["GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"]},"beneficiary":{"beneficiaryPersons":[{"naturalPerson":{"name":{"nameIdentifier":[{"primaryIdentifier":"Bola"}]}}}],"accountNumber":["GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"]},"transfer":{"amount":"10","asset":"USDC"}}
```

Canonical form (the bytes that are hashed):

```
{"beneficiary":{"accountNumber":["GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"],"beneficiaryPersons":[{"naturalPerson":{"name":{"nameIdentifier":[{"primaryIdentifier":"Bola"}]}}}]},"ivms101Version":"IVMS101.2023","originator":{"accountNumber":["GAAZI4TCR3TY5OJHCTJC2A4QSY6CJWJH5IAJTGKIN2ER7LBNVKOCCWN7"],"originatorPersons":[{"naturalPerson":{"name":{"nameIdentifier":[{"primaryIdentifier":"Ada"}]}}}]},"paymentId":"1","transfer":{"amount":"10","asset":"USDC"}}
```

SHA-256:

```
be84610f178ff28ed14d8ae5842355631d1192157edc96447a91854028abea44
```

### Vector 2: RFC 8785 appendix sample

Input:

```json
{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\u20ac$\u000F\u000aA'\u0042\u0022\u005c\\\"\/","literals":[null,true,false]}
```

Canonical form:

```
{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\u000f\nA'B\"\\\"/"}
```

Both vectors are checked by `__tests__/lib/canonical-json.test.ts`. Vector 1's
hash is also computed by an independent implementation (Python, `json.dumps`
with `sort_keys=True` and compact separators) to confirm it.
