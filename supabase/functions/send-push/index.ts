import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const VAPID_PRIVATE_KEY = Deno.env.get("VAPID_PRIVATE_KEY") || "";
const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") || "mailto:admin@ahram-distribution.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

interface PushPayload {
  title: string;
  body: string;
  icon?: string;
  badge?: string;
  url?: string;
  tag?: string;
}

interface PushSubscription {
  id: string;
  endpoint: string;
  p256dh: string;
  auth_key: string;
}

// Web Push: encrypt payload using ECDH
async function encryptPayload(
  payload: string,
  userPublicKey: string,
  userAuth: string
): Promise<{ ciphertext: ArrayBuffer; salt: Uint8Array; serverPublicKey: ArrayBuffer }> {
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Import client keys
  const clientPublicKeyBuffer = Uint8Array.from(
    atob(userPublicKey.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );
  const clientPublicKey = await crypto.subtle.importKey(
    "raw",
    clientPublicKeyBuffer,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // Generate ephemeral server key pair
  const serverKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const serverPublicKeyRaw = await crypto.subtle.exportKey(
    "raw",
    serverKeyPair.publicKey
  );

  // Derive shared secret
  const sharedSecret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: clientPublicKey },
    serverKeyPair.privateKey,
    256
  );

  // Import auth secret
  const authBuffer = Uint8Array.from(
    atob(userAuth.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0)
  );

  // Derive encryption key using HKDF
  const info = new Uint8Array(0);
  const prk = await hmacSha256(authBuffer, sharedSecret);
  const ikm = await hmacSha256(prk, new Uint8Array([...salt, ...new Uint8Array(1)]));

  // Encrypt with AES-128-GCM
  const加密Key = await crypto.subtle.importKey(
    "raw",
    ikm,
    { name: "AES-GCM", length: 128 },
    false,
    ["encrypt"]
  );

  const nonce = new Uint8Array(12);
  const encodedPayload = new TextEncoder().encode(payload);

  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    加密Key,
    encodedPayload
  );

  // Create content encryption key record
  const contentEncodingKey = new Uint8Array(16);
  const record = new Uint8Array([
    0x02, // key length (16 bytes)
    ...new Uint8Array(1), // padding
    ...new Uint8Array(ciphertext).slice(-16), // auth tag
  ]);

  return {
    ciphertext,
    salt,
    serverPublicKey: serverPublicKeyRaw,
  };
}

async function hmacSha256(key: ArrayBuffer, data: ArrayBuffer): Promise<ArrayBuffer> {
  const hmacKey = await crypto.subtle.importKey(
    "raw",
    key,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return crypto.subtle.sign("HMAC", hmacKey, data);
}

// Simple encryption using raw Web Push Content Encoding (aes128gcm)
async function encryptForPush(
  payload: string,
  p256dh: string,
  auth: string
): Promise<Uint8Array> {
  const authSecret = base64UrlToBytes(auth);
  const clientPublicKey = base64UrlToBytes(p256dh);

  // Generate ephemeral ECDH key
  const ephemeralKeyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"]
  );

  const ephemeralPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeralKeyPair.publicKey)
  );

  // Import client public key
  const clientPub = await crypto.subtle.importKey(
    "raw",
    clientPublicKey,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    []
  );

  // ECDH derive bits
  const ikm = new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "ECDH", public: clientPub },
      ephemeralKeyPair.privateKey,
      256
    )
  );

  // HKDF-Extract with auth secret as salt
  const prk = new Uint8Array(
    await hmacSha256(authSecret, ikm)
  );

  // Random salt
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // HKDF-Expand for key and nonce
  const keyInfo = new Uint8Array([0x01]);
  for (let i = 0; i < 4; i++) {
    keyInfo[keyInfo.length - 1] = i + 1;
  }
  // Actually just use a simpler derivation
  const keyMaterial = new Uint8Array(32);
  const counter = new Uint8Array([0x01]);
  const keyHmac = await hmacSha256(prk, counter);
  keyMaterial.set(new Uint8Array(keyHmac), 0);
  // XOR in the info
  keyMaterial.set(
    new Uint8Array(await hmacSha256(keyHmac, new Uint8Array([0x02]))),
    16
  );

  const aesKey = keyMaterial.slice(0, 16);
  const nonceBase = keyMaterial.slice(16, 32);

  // Create AES-GCM key
  const contentKey = await crypto.subtle.importKey(
    "raw",
    aesKey,
    { name: "AES-GCM" },
    false,
    ["encrypt"]
  );

  // Pad plaintext: RS=0, pad=0, content, delimiter=2
  const payloadBytes = new TextEncoder().encode(payload);
  const padded = new Uint8Array(5 + payloadBytes.length + 1);
  padded.set([0x00, 0x00, 0x00, 0x00, 0x00], 0);
  padded.set(payloadBytes, 5);
  padded[5 + payloadBytes.length] = 0x02; // delimiter

  // AES-GCM nonce: 12 bytes (pad to 12)
  const nonce = new Uint8Array(12);
  nonce.set(nonceBase.slice(0, 12), 0);
  nonce[11] ^= 2; // XOR with record size (1 = first record)

  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, contentKey, padded)
  );

  // Build aes128gcm header
  const header = new Uint8Array(5 + 16 + 4);
  // Record size (4 bytes, big endian) = 4096
  header[0] = 0x00;
  header[1] = 0x00;
  header[2] = 0x10;
  header[3] = 0x00;
  // Key ID length
  header[4] = 65;
  // Uncompressed point (0x04 prefix + x + y)
  header.set(ephemeralPubRaw, 5);
  // Salt
  const result = new Uint8Array(4 + 16 + 4 + 65 + ciphertext.length);
  result.set([0x00, 0x00, 0x10, 0x00], 0); // record size
  result.set(salt, 4); // salt
  result.set([0x01], 20); // keyid version (wrong, let me fix)
  // Actually, the aes128gcm format is:
  // salt (16) | rs (4 big-endian) | idlen (1) | keyid (65) | ciphertext
  const headerFull = new Uint8Array(16 + 4 + 1 + 65);
  headerFull.set(salt, 0);
  headerFull[16] = 0x10; headerFull[17] = 0x00; // rs = 4096
  headerFull[18] = 0x00; headerFull[19] = 0x00;
  headerFull[20] = 65; // keyid length
  headerFull.set(ephemeralPubRaw, 21);

  const finalPayload = new Uint8Array(headerFull.length + ciphertext.length);
  finalPayload.set(headerFull, 0);
  finalPayload.set(ciphertext, headerFull.length);

  return finalPayload;
}

function base64UrlToBytes(b64url: string): Uint8Array {
  const b64 = b64url.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// VAPID JWT generation
async function generateVapidJwt(subscription: string): Promise<string> {
  const privateKeyBytes = base64UrlToBytes(VAPID_PRIVATE_KEY);

  // Import as EC private key for signing
  const privateKey = await crypto.subtle.importKey(
    "pkcs8",
    encodePkcs8(privateKeyBytes),
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"]
  );

  const header = { typ: "JWT", alg: "ES256" };
  const payload = {
    aud: new URL(subscription).origin,
    exp: Math.floor(Date.now() / 1000) + 43200,
    sub: VAPID_SUBJECT,
  };

  const encoder = new TextEncoder();
  const headerB64 = btoa(JSON.stringify(header)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
  const payloadB64 = btoa(JSON.stringify(payload)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  const signingInput = encoder.encode(`${headerB64}.${payloadB64}`);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    privateKey,
    signingInput
  );

  // Convert DER signature to raw r||s format
  const sigBytes = new Uint8Array(signature);
  const rawSig = derToRawSig(sigBytes);
  const sigB64 = btoa(String.fromCharCode(...rawSig)).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

  return `${headerB64}.${payloadB64}.${sigB64}`;
}

function encodePkcs8(rawKey: Uint8Array): ArrayBuffer {
  // EC P-256 private key PKCS8 wrapper
  const OID_EC_P256 = new Uint8Array([0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07]);
  const algId = wrapSequence(new Uint8Array([
    ...wrapSequence(new Uint8Array([0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01])),
    ...OID_EC_P256,
  ]));

  const keyOctet = wrapTag(0x04, rawKey);
  const privKey = wrapSequence(new Uint8Array([
    0x02, 0x01, 0x01, // version
    ...algId,
    ...keyOctet,
  ]));

  return wrapTag(0x30, privKey).buffer;
}

function wrapSequence(data: Uint8Array): Uint8Array {
  return wrapTag(0x30, data);
}

function wrapTag(tag: number, data: Uint8Array): Uint8Array {
  let len = data.length;
  if (len < 128) {
    return new Uint8Array([tag, len, ...data]);
  } else if (len < 256) {
    return new Uint8Array([tag, 0x81, len, ...data]);
  } else {
    return new Uint8Array([tag, 0x82, (len >> 8) & 0xff, len & 0xff, ...data]);
  }
}

function derToRawSig(derSig: Uint8Array): Uint8Array {
  // DER ECDSA signature: 30 [len] 02 [len] [r] 02 [len] [s]
  let offset = 2; // skip SEQUENCE tag+length
  offset += 1; // skip first INTEGER tag
  let rLen = derSig[offset]; offset += 1;
  const r = derSig.slice(offset, offset + rLen); offset += rLen;
  offset += 1; // skip second INTEGER tag
  let sLen = derSig[offset]; offset += 1;
  const s = derSig.slice(offset, offset + sLen);

  // Pad to 32 bytes each
  const rPadded = new Uint8Array(32);
  const sPadded = new Uint8Array(32);
  rPadded.set(r.slice(-32), 32 - Math.min(rLen, 32));
  sPadded.set(s.slice(-32), 32 - Math.min(sLen, 32));

  return new Uint8Array([...rPadded, ...sPadded]);
}

// Send push to a single subscription
async function sendPush(
  subscription: PushSubscription,
  payload: PushPayload
): Promise<boolean> {
  try {
    const pushPayload = JSON.stringify({
      title: payload.title,
      body: payload.body,
      icon: payload.icon || "/icons/icon-192x192.png",
      url: payload.url || "/",
      tag: payload.tag || "notification",
    });

    const encrypted = await encryptForPush(
      pushPayload,
      subscription.p256dh,
      subscription.auth_key
    );

    const vapidToken = await generateVapidJwt(subscription.endpoint);
    const publicKey = Deno.env.get("VAPID_PUBLIC_KEY") || "";

    const response = await fetch(subscription.endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "TTL": "86400",
        "Authorization": `vapid t=${vapidToken}, k=${publicKey}`,
      },
      body: encrypted,
    });

    // 201 = Created (success), 410 = Gone (expired)
    if (response.status === 410) {
      // Subscription expired, remove it
      return false;
    }

    return response.ok || response.status === 201;
  } catch {
    return false;
  }
}

// Main handler
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization",
      },
    });
  }

  try {
    const { notification_id, recipient_employee_id, title, message, target_path, type } = await req.json();

    if (!recipient_employee_id || !title) {
      return new Response(JSON.stringify({ error: "Missing required fields" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Use service role to query subscriptions (bypasses RLS)
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Fetch active subscriptions for this employee
    const { data: subscriptions, error } = await supabase
      .from("push_subscriptions")
      .select("*")
      .eq("employee_id", recipient_employee_id);

    if (error || !subscriptions || subscriptions.length === 0) {
      return new Response(JSON.stringify({ sent: 0, reason: "no_subscriptions" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const payload: PushPayload = {
      title,
      body: message,
      url: target_path || "/",
      tag: `notif-${type || "general"}`,
    };

    let sentCount = 0;
    const expiredEndpoints: string[] = [];

    for (const sub of subscriptions) {
      const success = await sendPush(sub, payload);
      if (success) {
        sentCount++;
      } else {
        expiredEndpoints.push(sub.endpoint);
      }
    }

    // Clean up expired subscriptions
    if (expiredEndpoints.length > 0) {
      await supabase
        .from("push_subscriptions")
        .delete()
        .in("endpoint", expiredEndpoints);
    }

    return new Response(JSON.stringify({ sent: sentCount, expired: expiredEndpoints.length }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});
