const CODEC_VERSION = 1;

function writeVarint(value, output) {
  let remaining = Number(value);
  if (!Number.isSafeInteger(remaining) || remaining < 0) {
    throw new TypeError("Item IDs must be non-negative integers");
  }

  while (remaining >= 0x80) {
    output.push((remaining & 0x7f) | 0x80);
    remaining = Math.floor(remaining / 0x80);
  }
  output.push(remaining);
}

function bytesToBase64Url(bytes) {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64url");
  }

  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function base64UrlToBytes(value) {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError("Invalid build code");
  }

  if (typeof Buffer !== "undefined") {
    return Uint8Array.from(Buffer.from(value, "base64url"));
  }

  const normalized = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0));
}

export function encodeInventory(ids) {
  if (!Array.isArray(ids) || ids.length > 6) {
    throw new TypeError("An inventory can contain at most six item IDs");
  }

  const bytes = [CODEC_VERSION];
  ids.forEach((id) => writeVarint(id, bytes));
  return bytesToBase64Url(bytes);
}

export function decodeInventory(code) {
  if (!code) return [];

  const bytes = base64UrlToBytes(code);
  if (bytes[0] !== CODEC_VERSION) {
    throw new TypeError("Unsupported build code version");
  }

  const ids = [];
  let value = 0;
  let shift = 0;

  for (let index = 1; index < bytes.length; index += 1) {
    const byte = bytes[index];
    value += (byte & 0x7f) * 2 ** shift;

    if ((byte & 0x80) === 0) {
      if (!Number.isSafeInteger(value) || value < 0) {
        throw new TypeError("Invalid item ID in build code");
      }
      ids.push(value);
      if (ids.length > 6) throw new TypeError("Build code contains too many items");
      value = 0;
      shift = 0;
    } else {
      shift += 7;
      if (shift > 49) throw new TypeError("Item ID is too large");
    }
  }

  if (shift !== 0) throw new TypeError("Truncated build code");
  return ids;
}
