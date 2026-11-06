# End-to-end encrypted direct messages

Version 1 of the protocol (`v: 1`). Direct conversations (two people) only: groups and community
chats stay as they are. This file is the contract between the server and every client: the web
app, the macOS launcher, AnyPS5 Desktop and the phone app. The shared test vectors in
`packages/e2ee/test/e2ee-v1.json` pin it down byte for byte.

## What it protects, and what it does not

- The server keeps and relays only ciphertext of the text and attachments of an encrypted
  message. Whoever runs the server can no longer read them.
- The server still sees metadata: who writes to whom and when, message sizes, whether a message
  carries a photo, clip or voice note and how big it is, which message replies to which,
  reactions, read and delivered marks, edits and unsends, and the list of each person's devices.
- A malicious server could add a device to someone's account and so receive future messages.
  The defence is the safety number (below) and the notice clients show when someone's devices
  change. People who compared their safety number are safe from this until a notice appears.
- No forward secrecy beyond "one key per message": a device key that is stolen together with the
  stored ciphertext opens every message that was sent to that device. Signal-style ratchets are
  out of scope for v1.
- A new device cannot read anything sent before it was added. There is no key backup in v1.
- The link deny-list cannot check an encrypted message: the server never sees its text.

## Primitives and libraries

Never hand-rolled. Each platform uses one well-reviewed library:

| | Web and API | macOS launcher | Desktop and phone (Dart) |
| --- | --- | --- | --- |
| Library | `@noble/curves`, `@noble/ciphers`, `@noble/hashes` (audited) | Apple CryptoKit | `package:cryptography` |
| X25519 | `x25519` | `Curve25519.KeyAgreement` | `X25519()` |
| Ed25519 | `ed25519` | `Curve25519.Signing` | `Ed25519()` |
| AEAD | `chacha20poly1305` | `ChaChaPoly` | `Chacha20.poly1305Aead()` |
| HKDF-SHA-256, SHA-256 | `hkdf`, `sha256` | `HKDF<SHA256>`, `SHA256` | `Hkdf`, `Sha256()` |

The AEAD is ChaCha20-Poly1305 as in RFC 8439 (libsodium's `crypto_aead_chacha20poly1305_ietf`,
12-byte nonce), not XChaCha20-Poly1305. CryptoKit has no XChaCha20, and every key here encrypts
exactly one thing: a fresh random key per message, per attachment and per poster, and a fresh
ephemeral key pair per message for the key wraps. A nonce can therefore never repeat under one
key, which is the only thing XChaCha20's longer nonce buys. CryptoKit's Ed25519 signatures are
randomised. They verify everywhere, but only noble and Dart reproduce the vectors' signatures byte
for byte.

Encoding: binary values are standard base64 with padding. Text is UTF-8. `||` is concatenation.

## Device keys

Each signed-in device (one API session) makes, once, and keeps on the device only:

- an Ed25519 signing key pair (`signKey` is its public key), and
- an X25519 key pair (`boxKey` is its public key).

- `deviceId` = the first 16 bytes of SHA-256(`signKey`), lowercase hex (32 characters).
- `sig` = Ed25519 signature by the signing key over
  `utf8("AnyTogether-E2EE-v1/device\n" + userId + "\n") || boxKey`.

The private keys never leave the device: Keychain (macOS, iOS, this device only), Android
Keystore-backed storage, the Desktop launcher's token store, IndexedDB in the browser. Signing in
again on the same device registers the same keys under the new session.

`PUT /me/e2ee/device` registers this session's keys (`{signKey, boxKey, sig, name}`). The server
checks the signature and the user ID in it, and ties the keys to the session: signing out or
revoking the session removes them. `DELETE /me/e2ee/devices/:deviceId` removes one by hand.
`GET /e2ee/devices?users=a,b` returns each person's `devices` (active) and `removed` ones (kept to
verify old messages), for oneself and the people one has a direct conversation with. A change
reaches the person and those people as the gateway event `e2ee.devices` `{userId}`.

A client checks each device it gets: `deviceId` matches `signKey`, and `sig` verifies for that
user. A device that fails is ignored.

## Sealing a message

Given the conversation ID, the message's client ID, the sender's user ID and device ID:

1. `header` = `utf8("AnyTogether-E2EE-v1/msg\n" + conversationId + "\n" + messageId + "\n" + senderUserId + "\n" + senderDeviceId)`.
2. `payload` = UTF-8 JSON: `{"v":1,"text":"…"}` and/or an `"attachment"` (below).
3. `contentKey` = 32 random bytes, `nonce` = 12 random bytes.
   `body` = ChaCha20-Poly1305(`contentKey`, `nonce`, `payload`, aad = `header`).
4. A fresh ephemeral X25519 key pair (`eph` is its public key). For every active device `d` of
   both people (the sender's other devices and the sending device included):
   - `shared` = X25519(ephemeral private, `d.boxKey`). An all-zero result is refused.
   - `wrapKey` = HKDF-SHA-256(ikm = `shared`, salt = `eph || d.boxKey`,
     info = `"AnyTogether-E2EE-v1/wrap"`, 32 bytes).
   - `keys[d.deviceId]` = ChaCha20-Poly1305(`wrapKey`, 12 zero bytes, `contentKey`,
     aad = `header || utf8("\n" + d.deviceId)`). The zero nonce is safe: `wrapKey` is used once.
5. `sig` = Ed25519 by the sender device over `header || 0x00 || eph || nonce || SHA-256(body)`.

The message is sent as `{clientId, sealed: {v: 1, device, eph, nonce, body, sig, keys}, replyTo?,
attachments?}` with no `text`. Opening is the reverse: find this device's entry in `keys`, unwrap
`contentKey`, decrypt `body`, then verify `sig` with the sender device's `signKey` (active or
removed) of the message's author. A message that fails any step is shown as "could not be
decrypted", never as plain text. A message with no entry for this device was sent before the
device was added and says so.

An edit is a new seal of the same message ID (`PATCH` with `{sealed}`). The server could replay an
earlier version of an edited message as its current one: v1 accepts that.

### Attachments

An attachment is encrypted on the device before upload, with its own random 32-byte key and
12-byte nonce: ChaCha20-Poly1305(`key`, `nonce`, file, aad = `utf8("AnyTogether-E2EE-v1/file")`).
Photos are re-encoded on the device first so no location or camera data goes along (the server
does this for plain uploads but cannot for sealed ones). The ciphertext goes to
`POST /me/media/sealed?kind=image|clip|voice`; a clip's poster, sealed the same way with its own
key and aad `utf8("AnyTogether-E2EE-v1/poster")`, to `PUT /me/media/:id/poster`. The payload
carries what is needed to open and show it:

```json
{"v":1,"text":"caption","attachment":{"mediaId":"…","kind":"image","type":"image/webp",
 "size":123456,"key":"…","nonce":"…","width":1920,"height":1080,
 "poster":{"key":"…","nonce":"…","type":"image/jpeg"}}}
```

`durationMs` goes with clips and voice notes. The message's plain `attachments` list names the
media ID so the server knows who may fetch it. A client checks that the two IDs match.

## The rules the server keeps

- `sealed` only in a direct conversation, and `keys` must name exactly the active devices of both
  people. Otherwise `409 e2ee_devices` with the current lists, and the client fetches the devices,
  shows any change and seals again.
- A sealed message's attachments are sealed media, and a plain one's are plain media.
- No downgrade: once a direct conversation has a sealed message, or while both people have an
  active device key, a plain message is refused with `409 e2ee_required`. Clients keep their own
  record too and never send plain text in a conversation they have seen encrypted.
- A conversation with someone who has no device key yet (an older app) stays as it is today, and
  clients label it "Not end-to-end encrypted" with the reason.
- Notifications and pushes for a sealed message carry no text: "Sent you a message".
- Sealed media cannot be pinned to a gallery or put in a post.

## Safety number

For each person: SHA-256 of `utf8("AnyTogether-E2EE-v1/safety\n" + userId + "\n" +` their active
devices' `signKey`s as lowercase hex, sorted and joined with `","` `)`. Its first 30 bytes, in six
groups of five, each read as a big-endian 40-bit number modulo 100000 and written as five digits,
give 30 digits. The two people's 30 digits, the smaller user ID first, make the 60-digit safety
number, shown as twelve groups of five. Both people see the same number. It changes whenever
either person's devices change, and clients then show a notice in the conversation. A client may
remember that the person marked it as compared, and drops that mark when the number changes.

## Reporting

Reporting a sealed message sends its `contentKey` with the report. The server decrypts the stored
body with it, checks the author's signature, and keeps the text (and the attachment keys, so a
moderator can open them) in the report. So moderation still works, the server learns exactly the
reported messages and nothing else, and a report cannot put words in someone's mouth. The
privacy page says so.

## Voice calls

Calls and party voice are peer-to-peer WebRTC on every client: one `RTCPeerConnection` per other
person (`apps/web/lib/voice.ts`, the launcher's `PartyVoice.swift`, the Dart `voice_webrtc.dart`),
with the API handing out STUN and TURN credentials (`apps/api/src/calls.ts`) and the gateway
relaying offers, answers and candidates (`apps/realtime/src/gateway.ts`). There is no media server.
WebRTC always encrypts media with DTLS-SRTP between the two devices, and a TURN relay only forwards
those encrypted packets. So the audio is end-to-end encrypted against anyone who only watches or
relays, the TURN relay and the server's operator included.

The caveat: the DTLS fingerprints that tie the encryption to the two devices travel in the
offer and answer, through the gateway. A server that rewrites them could put itself in the middle
of a call. Binding the fingerprints to the device keys would close that. It is not in v1.
