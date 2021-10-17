interface Chat {
  id: string;
  t?: number;
}

interface Contact {
  id: string;
  name: string;
}

interface Group {
  id: string;
  subject: string;
}

interface MessageRowMessage {
  body: string;
}

interface MessageRow {
  currentMsg: MessageRowMessage;
  quotedMsg?: MessageRowMessage;
}

interface Message {
  id: string;
  t: number;
  from: string;
  to: {
    server: string;
    user: string;
    _serialized: string;
  };
  participant: {
    server: string;
    user: string;
    _serialized: string;
  };
  author: {
    server: string;
    user: string;
    _serialized: string;
  };
  msgRow?: MessageRow;
  filehash?: string;
  mimetype?: string;
}

interface WhatsAppData {
  "message.json": Message[],
  "chat.json": Chat[],
  "group-metadata.json": Group[],
  "contact.json": Contact[],
  "media": { [filehash: string]: ArrayBuffer },
}
