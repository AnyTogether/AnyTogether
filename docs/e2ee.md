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

A device's `name` says only what it is: the launchers register "AnyPS5 on Windows", "AnyPS5 on
Linux" and "AnyPS5 on Mac", the web "<browser> on <system>". Older launchers sent the computer's
own name, which often holds a person's name, so other people's devices are listed by their kind
alone ("Windows PC", "iPhone", "Device"), read from the name by `deviceKindOf` in
packages/e2ee. Clients show every device, their own too, as its kind and the day it was added.

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

## API, in short

Types are in `packages/shared/src/e2ee.ts`, `messages.ts` and `storage.ts`.

| Call | What |
| --- | --- |
| `PUT /me/e2ee/device` `{signKey, boxKey, sig, name}` | This session's keys: 201 new, 200 again. `409 conflict` past 16 devices. |
| `GET /me/e2ee/device` | This session's device, or 404. |
| `DELETE /me/e2ee/devices/:id` | Removes one of one's devices. 204. |
| `GET /e2ee/devices?users=a,b` | `{users: [{userId, devices, removed}]}` for oneself, friends and direct-conversation partners (others are left out). At most 20 IDs. |
| `POST /conversations/:id/messages` `{clientId, sealed, replyTo?, attachments?}` | A sealed message. `409 e2ee_devices` `{devices}`, `409 e2ee_required` for a plain one. |
| `PATCH /conversations/:id/messages/:seq` `{sealed}` | Edits a sealed message. |
| `POST /me/media/sealed?kind=image\|clip\|voice` | The ciphertext as the body, at most the kind's limit plus 16 bytes. |
| `PUT /me/media/:id/poster` | For sealed media, the poster's ciphertext. |
| `POST /reports` `{targetKind: "message", targetId, reason, contentKey}` | `contentKey` is required for a sealed message. |

A sealed message's `MessageView` has `sealed` (as sent) and `text: "[encrypted message]"` for older
clients. Its attachment is a `MediaView` with `sealed: true` and no thumbnail. `ConversationView`
has `encrypted: true` once a sealed message is in it. The gateway event `e2ee.devices` `{userId}`
says someone's devices changed. A message notification for a sealed message has `data.sealed: true`
and empty `data.text`.

## What every client does

The web app, the macOS launcher, AnyPS5 Desktop and the phone app behave the same:

1. Signed in, the client makes its device keys once, keeps them on the device, and registers them
   (`GET /me/e2ee/device`, then `PUT` when missing or different). A server without these routes
   (404) means no encryption: everything stays as today.
2. Opening a direct conversation, it fetches both people's devices and checks each one. It fetches
   them again on `e2ee.devices` and on `409 e2ee_devices`.
3. Both people have a device: every message is sealed. The other person has none and the
   conversation is not `encrypted` (and this device never saw it encrypted): plain, with the
   "not encrypted" label. Encrypted but the other person has no device now: the composer says so
   and sends nothing.
4. A sealed message is opened on the device. No key for this device: "Sent before this device was
   added." Anything else that fails: "This message could not be decrypted."
5. The thread shows the lock state. It opens a sheet with what it means, the safety number in
   twelve groups of five, a "We compared them" mark and both people's devices, each as its kind
   and the day it was added (never a computer's name or a device ID).
6. The client remembers, per conversation, the devices it last saw. When they change it shows a
   notice in the thread until it is dismissed, and drops the "compared" mark. The first time it
   only remembers.
7. Photos are re-encoded before they are sealed. Attachments are downloaded, opened and shown
   from memory or a temporary file.
8. Reporting a sealed message sends its content key. The report sheet says the moderators will
   read the message.
9. The conversation list opens the last message for its preview ("Encrypted message" when it
   cannot). A notification with `data.sealed` says "Sent you a message."

Texts, English and Turkish:

| Key | English | Turkish |
| --- | --- | --- |
| on | End-to-end encrypted | Uçtan uca şifreli |
| onDetail | Only your devices and {name}'s can read the messages and attachments here. Not even the server can. | Buradaki mesajları ve ekleri yalnızca sen ve {name} cihazlarınızda okuyabilirsiniz. Sunucu bile okuyamaz. |
| off | Not end-to-end encrypted | Uçtan uca şifreli değil |
| offDetail | {name} uses an app that does not support it yet. Messages here work as before. | {name} bunu henüz desteklemeyen bir uygulama kullanıyor. Buradaki mesajlar eskisi gibi çalışır. |
| noDevice | {name} is not signed in on a device that can read encrypted messages. They need an up-to-date app. | {name} şifreli mesajları okuyabilen bir cihazda oturum açmamış. Güncel bir uygulama gerekiyor. |
| safetyNumber | Safety number | Güvenlik numarası |
| safetyHow | Compare these numbers with {name} in person or on a call. If they match, nobody is in between. | Bu numaraları {name} ile yüz yüze ya da bir aramada karşılaştırın. Aynıysa aranızda kimse yok. |
| markCompared | We compared them | Karşılaştırdık |
| compared | Compared | Karşılaştırıldı |
| devicesChanged | {name}'s devices changed. Compare the safety number again. | {name} cihazlarını değiştirdi. Güvenlik numarasını yeniden karşılaştırın. |
| myDevicesChanged | Your devices changed. Compare the safety number again. | Cihazların değişti. Güvenlik numarasını yeniden karşılaştırın. |
| compare | Compare | Karşılaştır |
| dismiss | OK | Tamam |
| devices | Devices | Cihazlar |
| you | You | Sen |
| newDeviceNote | A new device cannot read messages sent before it was added. | Yeni bir cihaz, eklenmeden önce gönderilen mesajları okuyamaz. |
| deviceAdded | Added {date} | Eklenme: {date} |
| deviceWindows | Windows PC | Windows bilgisayar |
| deviceMac | Mac | Mac |
| deviceLinux | Linux PC | Linux bilgisayar |
| deviceIphone | iPhone | iPhone |
| deviceIpad | iPad | iPad |
| deviceAndroid | Android phone | Android telefon |
| deviceBrowser | Web browser | Web tarayıcısı |
| deviceOther | Device | Cihaz |
| beforeDevice | Sent before this device was added. | Bu cihaz eklenmeden önce gönderildi. |
| undecryptable | This message could not be decrypted. | Bu mesajın şifresi çözülemedi. |
| preview | Encrypted message | Şifreli mesaj |
| notification | Sent you a message. | Sana bir mesaj gönderdi. |
| reportNote | Reporting sends this message to the moderators so they can read it. | Bildirirsen bu mesaj, okuyabilmeleri için moderatörlere gönderilir. |

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

A call between two people is peer-to-peer WebRTC on every client: one `RTCPeerConnection` per
other person (`apps/web/lib/voice.ts`, the launcher's `PartyVoice.swift`, the Dart
`voice_webrtc.dart`). The API hands out STUN and TURN credentials (`apps/api/src/calls.ts`) and
the gateway relays offers, answers and candidates (`apps/realtime/src/gateway.ts`). WebRTC always
encrypts media with DTLS-SRTP between the two devices, and a TURN relay only forwards those
encrypted packets. So the audio of a 1:1 call is end-to-end encrypted against anyone who only
watches or relays, the TURN relay and the server's operator included.

Two caveats:

- The server-side media path. A party call with more than eight voices moves to the media server
  (LiveKit, `apps/api/src/sfu.ts`, `outgrown` in `calls.ts`) when the server has one. A media
  server ends the encryption and forwards the audio, so it can hear that call. A direct call never
  moves there (`outgrown` returns early without a party).
- The DTLS fingerprints that tie the encryption to the two devices travel in the offer and answer,
  through the gateway. A server that rewrites them could put itself in the middle of a call.
  Binding the fingerprints to the device keys would close that. It is not in v1: it changes the
  call signalling on all four clients, so it is not cheap.
