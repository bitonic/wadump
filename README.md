# wadump

Small utility to dump and display the data in the WhatsApp web client. Dumps the messages, contacts, chat and group information. Also dumps all the media that can be dumped, although some media downloads fail, and I am currently not sure why.

It only works with the [multi-device beta](https://faq.whatsapp.com/general/download-and-installation/about-multi-device-beta/?lang=en) enabled.

See [the blog post](https://mazzo.li/posts/whatsapp-backup.html) about this project for more information about the implementation details.

I've also only tested this on Chrome, although in principle it should work on every browser.

## Existing work

After I wrote the tool and the blog post, I realized that somebody had [already reverse engineered the WhatsApp web client protocol](https://github.com/sigalor/whatsapp-web-reveng). Head that way for a detailed description of how the web client communicates with the WhatsApp servers.

## Disclaimer

I am not affiliated with Facebook or WhatsApp, and this investigation was done purely to preserve my personal data better. I don't know if backing up your data this way breaches WhatsApp's terms of service. Use at your own risk!

Also, you probably shouldn't be running random code from the internet in your browser, especially in your WhatsApp window. That said, [`dump-messages.js`](./dump-messages.js) is less than 500 lines long and with no dependencies, so if you do want to try this, please read it all first.

## To dump the data

Open the dev tools while on `web.whatsapp.com`. [Create a new snippet](https://developer.chrome.com/docs/devtools/javascript/snippets/), and paste the contents [`dump-messages.js`](./dump-messages.js) into it.

Then customize the invocation of `dumpMessages` at the end:

```javascript
dumpWhatsApp({
  // Save media on top of text messages
  dumpMedia: true,
  // Dump only media which is already cached locally. Only relevant if `dumpMedia` is
  // true.
  dumpOnlyCachedMedia: true,
  // Cache newly downloaded media, so that it won't be redownloaded the next time.
  // note. Only relevant if `dumpOnlyCachedMedia` is false.
  saveDownloadedMediaToCache: true,
});
```

It is advisable to first run once with `dumpOnlyCachedMedia: true`, since downloading the media can take a while. If you _are_ downloading media, some will probably fail to download, which will show up as errors in the console. Regardless, all the media that can be downloaded will be downloaded.

After you've decided on the configuration parameters, start the snippet by pressing `Ctrl+Enter`, or by pressing the button on the bottom right.

Once you started the script, to decrypt the messages the script needs to retrieve the decryption key. This can be done by opening a chat and scrolling to older messages, as the console message instructs you to do:

```
no decrypt args found, waiting for them (open a few chats!)
```

Once the key is retrieved, you'll see this message:

```
decrypt args found {algorithm: {…}, key: CryptoKey}
```

And the script will start reading and decrypting all the messages. When it is done they will be downloadable as a `whatsapp.tar` file.

If you're not downloading media files it should only take a few seconds. If you are downloading the media it will take much longer.

## To view the data

A very basic viewer is provided to view the data:

```
% yarn install
% yarn parcel
Server running at http://localhost:1234
```

Once it's running, just go to the webpage, upload the `whatsapp.tar` file, and you will be presented with the dumped chats.

## Bugs & Limitations

* Not all media is reliably downloaded. See <https://mazzo.li/posts/whatsapp-backup.html#media-troubles>. The best way to get around this limitation is to write an extension which continuously syncs a filesystem backup with the web client using the new [File System Access API](https://developer.mozilla.org/en-US/docs/Web/API/File_System_Access_API), which would work around CDN links expiring.

* Everything is done in RAM, which means that all your messages and media need to fit in RAM. This would also be obviated if the script wrote directly to the filesystem.

* We handle quoted messages incompletely: we display quoted text with >> as the prefix in the viewer, and we do not handle media in quoted messages.

* We do not retrieve profile images.

* The viewer is extremely basic. It inlines all media using base64 encoding, which makes loading chats with a lot of media very slow.