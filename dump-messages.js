// See README.md for instructions on how to use this file.
//
// I wanted this to be a single file with no dependencies, so we implement
// various things we normally would not implement, like a minimal protobuf
// reader and a tar archive generator.
(() => {
  "use strict";

  const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
  const utf8Encoder = new TextEncoder();

  // protobuf varint decoder
  function decodeVarint(s) {
    let number = 0;
    let more = false;
    let parsedBytes = 0;
    do {
      if (parsedBytes > 3) {
        throw "trying to parse varint wider than 4 bytes, we don't support this since we need to fit within 32 bits";
      }
      if (s.cursor >= s.length) {
        throw "EOF while parsing varint";
      }
      const byte = s.data.getUint8(s.cursor); s.cursor += 1;
      more = !!(byte & 0x80);
      number += (byte & 0x7f) << (parsedBytes * 7);
      parsedBytes += 1;
    } while (more);
    return number;
  }

  // protobuf message decoder. See `decodeWhatsAppProtobuf` message for example on
  // the spec format. We currently only bother with strings, since I only encountered
  // those so far.
  //
  // rule: we increase cursor _as soon as the data is consumed_.
  // cursor should always be at the byte we need to read next.
  function decodeProtobufWithState(spec, s) {
    const result = {};
    while (s.cursor < s.length) {
      const header = s.data.getUint8(s.cursor); s.cursor += 1;
      const field = header >> 3;
      const wireType = header & 0x7;
      const fieldSpec = spec[field];
      if (fieldSpec === undefined) {
        throw `non-specced field ${field}`;
      }
      let fieldValue = null;
      if (wireType === 1) { // fixed64, sfixed64, double
        if (fieldSpec.type === "double") {
          fieldValue = s.data.getFloat64(s.cursor, true); s.cursor += 8;
        } else if (fieldSpec.type === "int64") {
          fieldValue = s.data.getBigInt64(s.cursor, true); s.cursor += 8;
        } else if (fieldSpec.type === "uint64") {
          fieldValue = s.data.getBigUint64(s.cursor, true); s.cursor += 8;
        } else {
          throw `bad type for 64-bit data: ${fieldSpec.type}`;
        }
      } else if (wireType === 2) { // length-delimited
        const length = decodeVarint(s);
        if (fieldSpec.type === "string") {
          fieldValue = utf8Decoder.decode(new DataView(s.data.buffer, s.data.byteOffset + s.cursor, length));
          s.cursor += length;
        } else if (typeof fieldSpec.type === "object") {
          fieldValue = decodeProtobufWithState(fieldSpec.type, {
            data: new DataView(s.data.buffer, s.data.byteOffset + s.cursor, length),
            cursor: 0,
            length: length,
          });
          s.cursor += length;
        } else {
          throw `bad field type for length-delimited data ${JSON.stringify(fieldSpec.type)}`;
        }
      } else if (wireType === 5) { // fixed32, sfixed32, float
        if (fieldSpec.type === "float") {
          fieldValue = s.data.getFloat32(s.cursor, true); s.cursor += 4;
        } else if (fieldSpec.type === "int32") {
          fieldValue = s.data.getInt32(s.cursor, true); s.cursor += 4;
        } else if (fieldSpec.type === "uint32") {
          fieldValue = s.data.getInt32(s.cursor, true); s.cursor += 4;
        } else {
          throw `bad type for 32-bit data: ${fieldSpec.type}`;
        }        
      } else {
        throw `unimplemented wire type ${wireType}`;
      }
      result[fieldSpec.name] = fieldValue;
    }
    if (s.cursor !== s.length) {
      throw `mismatching cursor ${s.cursor} and length ${s.length}`;
    }
    return result;
  }

  // this assumes that there are no fields >= 32.
  function decodeProtobuf(spec, buffer) {
    const data = new DataView(buffer, 0);
    return decodeProtobufWithState(spec, { data, cursor: 0, length: buffer.byteLength });
  }

  // decoding whatsapp protobufs. note that here we have
  // things other than "string", I just never encountered them in
  // my dataset.
  function decodeWhatsAppProtobufMessage(buffer) {
    const msgSpec = {
      1: { name: "body", type: "string" },
      3: { name: "caption", type: "string" },
      5: { name: "lng", type: "double" },
      6: { name: "isLive", type: "bool" },
      7: { name: "lat", type: "double" },
      8: { name: "paymentAmount1000", type: "int32" },
      9: { name: "paymentNoteMsgBody", type: "string" },
      10: { name: "canonicalUrl", type: "string" },
      11: { name: "matchedText", type: "string" },
      12: { name: "title", type: "string" },
      13: { name: "description", type: "string" },
      14: { name: "futureproofBuffer", type: "bytes" },
      15: { name: "clientUrl", type: "string" },
      16: { name: "loc", type: "string" },
      17: { name: "pollName", type: "string" },
      // 18: { name: "pollOptions"}, not implemented, repeated messages
      20: { name: "pollSelectableOptionsCount", type: "uint32" },
      21: { name: "messageSecret", type: "bytes" },
      22: { name: "senderTimestampMs", type: "int64" },
      23: { name: "pollUpdateParentKey", type: "string" },
      // 24: { name: "encPollVote" }, not implemented, repeated messages
    };
    const fullMsgSpec = {
      1: { name: "currentMsg", type: msgSpec },
      2: { name: "quotedMsg", type: msgSpec },
    };
    return decodeProtobuf(fullMsgSpec, buffer);
  }

  // see <https://stackoverflow.com/a/34156339/524111>
  function saveFile(fileName, contentType, content) {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
  }

  // tar a bunch of files, each a [name, blob] pair.
  // see <https://en.wikipedia.org/wiki/Tar_(computing)#File_format>
  function saveTar(fileName, contents) {
    let tarBufferLen = 512*2; // the final zero-headers
    const buffers = contents.map(([name, content]) => {
      const buffer = new Uint8Array(content);
      tarBufferLen += 512 + Math.ceil(buffer.length/512)*512; // padded header size is 512, we need to round up to 512
      const nameBuffer = utf8Encoder.encode(name);
      if (nameBuffer.byteLength > 100) {
        throw `Tar name too long (${nameBuffer.byteLength})`;
      }
      return [nameBuffer, buffer];
    });
    const tarBuffer = new Uint8Array(tarBufferLen);
    let cursor = 0;
    const writeHeaderNum = (size, num, offset) => {
      const str = num.toString(8).padStart(size - 1, "0"); // last must be null
      tarBuffer.set(utf8Encoder.encode(str), cursor + offset);
    };
    for (const [nameBuffer, fileBuffer] of buffers) {
      tarBuffer.set(nameBuffer, cursor); // write file name
      writeHeaderNum(12, fileBuffer.byteLength, 124); // write file size
      writeHeaderNum(8, 420, 100); // file mode -- octal 644
      tarBuffer[cursor + 156] = "0".charCodeAt(0); // write file type
      // calculate header checksum
      for (let i = 0; i < 8; i++) {
        tarBuffer[cursor + 148 + i] = 32;
      }
      let headerChecksum = 0;
      for (let i = 0; i < 512; i++) {
        headerChecksum += tarBuffer[cursor + i];
      }
      writeHeaderNum(6, headerChecksum, 148); tarBuffer[cursor + 148 + 7] = 32; // write checksum
      tarBuffer.set(fileBuffer, cursor + 512); // write file contents
      cursor += 512 + Math.ceil(fileBuffer.length/512)*512;
    }
    saveFile(fileName, "application/gzip", tarBuffer);
  }

  // HKDF info for encrypted WhatsApp media
  function mediaHkdfInfo(type) {
    if (type === "image" || type === "sticker") {
      return "WhatsApp Image Keys";
    } else if (type === "ptt" || type === "audio") {
      return "WhatsApp Audio Keys";
    } else if (type === "video") {
      return "WhatsApp Video Keys";
    } else if (type === "document") {
      return "WhatsApp Document Keys";
    } else {
      throw `Bad media type ${type}`;
    }
  }

  function isMediaMessage(type) {
    return ["image", "sticker", "ptt", "audio", "video", "document"].indexOf(type) >= 0;
  }

  // HKDF parameters for encrypted whatsapp media
  const hkdfHashLen = 32;
  const hkdfAlgo = { "name": "HMAC", "hash": { "name": "SHA-256" } };

  // HKDF extract, see <https://datatracker.ietf.org/doc/html/rfc5869>
  async function hkdfExtract({ salt, ikm }) {
    const key = await crypto.subtle.importKey("raw", salt, hkdfAlgo, false, ["sign"]);
    const prkBytes = await crypto.subtle.sign(hkdfAlgo, key, ikm);
    return crypto.subtle.importKey("raw", prkBytes, hkdfAlgo, false, ["sign"]);
  }

  // HKDF expand, see <https://datatracker.ietf.org/doc/html/rfc5869>
  async function hkdfExpand({ prk, info, length }) {
    const n = Math.ceil(length / hkdfHashLen);
    let okm = new Uint8Array(n*hkdfHashLen);
    let t = new Uint8Array();
    for (let i = 0; i < n; i++) {
      t = await crypto.subtle.sign(hkdfAlgo, prk, new Uint8Array([...new Uint8Array(t), ...info, i + 1]));
      okm.set(new Uint8Array(t), i*hkdfHashLen);
    }
    okm = okm.slice(0, length);
    return okm;
  }

  // HKDF, see <https://datatracker.ietf.org/doc/html/rfc5869>
  async function hkdfExtractAndExpand({ ikm, info, salt, length }) {
    salt = salt || new Uint8Array(hkdfHashLen);
    const prk = await hkdfExtract({ salt, ikm });
    return hkdfExpand({ prk, info, length });
  }

  // generate media keys from the base64 `mediaKey` message field
  async function generateMediaKeys(type, mediaKeyString) {
    const mediaKey = Uint8Array.from(window.atob(mediaKeyString), c => c.charCodeAt(0));
    const infoString = mediaHkdfInfo(type);
    const info = utf8Encoder.encode(infoString);
    const key = await hkdfExtractAndExpand({
      ikm: mediaKey,
      info,
      length: 112,
    });
    return {
      iv: key.slice(0, 16),
      encKey: key.slice(16, 48),
      macKey: key.slice(48, 80),
      refKey: key.slice(80, 112)
    };
  }

  async function decryptMedia(mediaKeys, bytes) {
    const key = await crypto.subtle.importKey("raw", mediaKeys.encKey, "AES-CBC", false, ["decrypt"]);
    bytes = bytes.slice(0, -10); // drop the mac
    const cleartext = await crypto.subtle.decrypt({ name: "AES-CBC", iv: mediaKeys.iv }, key, bytes);
    return cleartext;
  }

  // this seems to be the fallback CDN domain for WhatsApp media
  const mediaHostname = "mmg.whatsapp.net";

  // downloads and decrypts a media message. first looks in the cache to minimize
  // downloads.
  async function downloadAndDecryptMedia(config, mediaCache, stats, msg) {
    // TODO figure out what to do when there's no media key
    if (msg.mediaKey === undefined) {
      stats.noMediaKey.add(msg.id);
      return null;
    }
    if (msg.filehash === undefined) {
      stats.noFileHash.add(msg.id);
    }
    const cacheKey = `https://_media_cache_v2_.whatsapp.com/${encodeURIComponent(`lru-media-array-buffer-cache_${msg.filehash}`)}`;
    const cachedBytes = await mediaCache.match(cacheKey);
    if (cachedBytes) {
      stats.cachedMediaDownloads.add(msg.id);
      return cachedBytes.arrayBuffer();
    } else if (config.dumpOnlyCachedMedia) {
      return null;
    }
    const mediaKeys = await generateMediaKeys(msg.type, msg.mediaKey);
    const fileUrl = `https://${mediaHostname}${msg.directPath}`;
    let fileResp = null;
    // TODO figure out why there are so many bad URLs in IndexedDB
    try {
      fileResp = await fetch(fileUrl);
    } catch (e) {
      stats.failedMediaDownload.add(msg.id);
      return null;
    }
    if (!fileResp.ok) {
      stats.failedMediaDownload.add(msg.id);
      return null;
    }
    stats.successfulMediaDownloads.add(msg.id);
    const bytes = await fileResp.arrayBuffer();
    const cleartext = await decryptMedia(mediaKeys, bytes);
    if (config.saveDownloadedMediaToCache) {
      await mediaCache.put(cacheKey, new Response(cleartext));
    }
    return cleartext;
  }

  // See <https://stackoverflow.com/a/9458996/524111>
  function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array( buffer );
    const len = bytes.byteLength;
    for (let i = 0; i < len; i++) {
      binary += String.fromCharCode( bytes[ i ] );
    }
    return window.btoa(binary);
  }

  // decrypt and decode a single message
  async function decryptMessage(config, mediaCache, { algorithm, key }, stats, messages, mediaBlobs, encodedMessage) {
    if (encodedMessage.msgRowOpaqueData) {
      const msgBytes = await crypto.subtle.decrypt(
        { ...algorithm, iv: encodedMessage.msgRowOpaqueData.iv },
        key,
        encodedMessage.msgRowOpaqueData._data,
      );  
      delete encodedMessage.msgRowOpaqueData;  
      encodedMessage.msgRowData = arrayBufferToBase64(msgBytes);
      if (encodedMessage.type === "chat") {
        let decoded = null;
        try {
          decoded = decodeWhatsAppProtobufMessage(msgBytes);
        } catch (e) {
          console.error(`could not decode message ${encodedMessage.id}`, e);
          throw e;
        }
        encodedMessage.msgRow = decoded;
      } else if (config.dumpMedia && isMediaMessage(encodedMessage.type)) {
        let mediaBytes = null;
        try {
          mediaBytes = await downloadAndDecryptMedia(config, mediaCache, stats, encodedMessage);
        } catch (e) {
          console.error(`could not download and decrypt media for message ${encodedMessage.id}`, e);
          throw e;
        }
        if (mediaBytes !== null) {
          mediaBlobs[encodedMessage.filehash] = mediaBytes;
        }
      } else {
        stats.unknownType.add(encodedMessage.id);
      }
    }
    messages.push(encodedMessage);  
  }

  // fetch and decrypt all messages
  function dumpMessages(config, { db, mediaCache, decryptArgs }, cont) {
    console.log("fetching messages");
    const objectStore = db.transaction("message").objectStore("message");
    const mediaBlobs = {};
    const stats = {
      unknownType: new Set(),
      noMediaKey: new Set(),
      noFileHash: new Set(),
      failedMediaDownload: new Set(),
      successfulMediaDownloads: new Set(),
      cachedMediaDownloads: new Set(),
    };
    objectStore.getAll().onsuccess = async (e) => {
      const messages = [];
      const seenTypes = new Set();
      console.log("fetched all messages, decrypting");
      for (const msg of e.target.result) {
        seenTypes.add(msg.type);
        await decryptMessage(config, mediaCache, decryptArgs, stats, messages, mediaBlobs, msg);
      }
      console.log(`${messages.length} messages decoded`);
      console.log(`${stats.unknownType.size} messages skipped because of unknown type`);
      console.log(`${stats.noMediaKey.size} messages skipped because they had no mediaKey`);
      console.log(`${stats.failedMediaDownload.size} failed media downloads`);
      console.log(`${stats.successfulMediaDownloads.size} successful media downloads`);
      console.log(`${stats.cachedMediaDownloads.size} cached media downloads`);
      console.log("seen message types", seenTypes);
      cont(messages, mediaBlobs);
    };
  }

  // Get the args to pass to window.subtle.decrypt
  window.whatsappDecryptArgs = window.whatsappDecryptArgs || null;
  async function retrieveMessageDecryptArgs({ db }, withDecryptArgs) {
    // we get any message, and keep trying to decrypt it with the args
    // until one works.
    if (window.whatsappDecryptArgs !== null) {
      console.log("reusing previously stored decryption arguments");
      withDecryptArgs(window.whatsappDecryptArgs);
      return;
    }
    console.log("no decrypt args found, waiting for them (open a few chats!)");
    const objectStore = db.transaction("message").objectStore("message");
    objectStore.openCursor().onsuccess = (event) => {
      const cursor = event.target.result;
      const message = event.target.result.value;
      if (message.msgRowOpaqueData && message.type === "chat") {
        const testData = message.msgRowOpaqueData;
        const originalDecrypt = window.crypto.subtle.decrypt;
        window.crypto.subtle.decrypt = function (algorithm, key, data) {
          // try to decode
          if (window.whatsappDecryptArgs === null) {
            // eslint-disable-next-line @typescript-eslint/no-this-alias
            const that = this;
            (async () => {
              try {
                const msgBytes = await originalDecrypt.call(that, { ...algorithm, iv: testData.iv }, key, testData._data);
                decodeWhatsAppProtobufMessage(msgBytes);
                // We've made it, store the key
                if (window.whatsappDecryptArgs !== null) { return; } // somebody might have gotten there first, it's async
                window.crypto.subtle.decrypt = originalDecrypt;
                window.whatsappDecryptArgs = { algorithm: { ...algorithm }, key };
                delete window.whatsappDecryptArgs.algorithm.iv;
                console.log("decrypt args found", window.whatsappDecryptArgs);
                withDecryptArgs(window.whatsappDecryptArgs);
              } catch (e) {
                console.debug("could not decode test data", e);
              }
            })();
          }
          return originalDecrypt.call(this, algorithm, key, data);
        };  
      } else {
        cursor.continue();
      }
    };
  }

  // dumps an entire object store
  function dumpObjectStore(db, name, cont) {
    const objectStore = db.transaction(name).objectStore(name);
    console.log(`fetching object store ${name}`);
    objectStore.getAll().onsuccess = (event) => cont(event.target.result);
  }

  // sniffs the message encryption key, decrypts all the messages (downloading
  // & decrypting the media if requested), saves other useful object stores,
  // and packs them in a `whatsapp.tar` file.
  async function dumpWhatsApp(config) {
    // we first open the two main things we need -- the media cache and the database
    const mediaCache = await caches.open("lru-media-array-buffer-cache");
    indexedDB.open("model-storage").onsuccess = (modelEv) => {
      const db = modelEv.target.result;
      // then we sniff the message key and dump the messages
      retrieveMessageDecryptArgs({ db, mediaCache }, decryptArgs =>
        dumpMessages(config, { db, mediaCache, decryptArgs }, (messages, mediaBlobs) =>
        dumpObjectStore(db, "chat", chats =>
        dumpObjectStore(db, "contact", contacts =>
        dumpObjectStore(db, "group-metadata", async groups => {
          const tarContents = [
            ["message.json", await utf8Encoder.encode(JSON.stringify(messages))],
            ["chat.json", await utf8Encoder.encode(JSON.stringify(chats))],
            ["contact.json", await utf8Encoder.encode(JSON.stringify(contacts))],
            ["group-metadata.json", await utf8Encoder.encode(JSON.stringify(groups))],
          ];
          for (const [hash, blob] of Object.entries(mediaBlobs)) {
            tarContents.push([
              `media/${hash.replace(/\//g, "_").replace(/\+/g, "-").replace(/=+$/, "")}`,
              blob
            ]);
          }
          saveTar("whatsapp.tar", tarContents);
        }
      )))));
    };
  }

  dumpWhatsApp({
    // Save media on top of text messages
    dumpMedia: false,
    // Dump only media which is already cached locally. Only relevant if `dumpMedia` is
    // true.
    dumpOnlyCachedMedia: true,
    // Cache newly downloaded media, so that it won't be redownloaded the next time.
    // note. Only relevant if `dumpOnlyCachedMedia` is false.
    saveDownloadedMediaToCache: true,
  });
})();
