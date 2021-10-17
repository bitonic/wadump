// In a separate file so fast-refresh works
import * as React from "react";

import "./node_modules/bootstrap/dist/css/bootstrap.min.css";

function renderTime(t: number): string {
  return new Date(t*1000).toLocaleString();
}

const SidebarChat: React.FunctionComponent<{
  contacts: {[phoneNumber: string]: Contact},
  groups: {[phoneNumber: string]: Group},
  chat: Chat
}> = ({ contacts, groups, chat }) => {
  const [phoneNumber, _] = chat.id.split("@");
  const contact = contacts[phoneNumber];
  const group = groups[phoneNumber];
  if (group) {
    return <div>{group.subject} <small>(group)</small></div>;
  } else if (contact) {
    return <div>{contact.name}</div>;
  } else {
    return <div>{phoneNumber}</div>;
  }
};

// See <https://stackoverflow.com/a/9458996/524111>
function arrayBufferToBase64(buffer: ArrayBuffer) {
  let binary = "";
  const bytes = new Uint8Array( buffer );
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode( bytes[ i ] );
  }
  return window.btoa(binary);
}

const Media: React.FunctionComponent<{ blob: ArrayBuffer, mimetype: string }> = ({ blob, mimetype }) => {
  if (mimetype.startsWith("image/")) {
    return <img style={{maxWidth: "80%", maxHeight: "80%"}} src={`data:${mimetype};base64,${arrayBufferToBase64(blob)}`} />;
  } else if (mimetype.startsWith("audio/")) {
    return <audio controls={true} src={`data:${mimetype};base64,${arrayBufferToBase64(blob)}`} />;
  } else if (mimetype.startsWith("video/")) {
    return <video style={{maxWidth: "80%", maxHeight: "80%"}} controls>
      <source src={`data:${mimetype};base64,${arrayBufferToBase64(blob)}`} />
    </video>;
  } else {
    return <>{`<media with unknown mimetype ${mimetype}`}</>;
  }
};

// When null, we sent the message
const ChatMessage: React.FunctionComponent<{
  contacts: {[phoneNumber: string]: Contact},
  media: {[hash: string]: ArrayBuffer},
  contact: string | null,
  message: Message,
  group: boolean,
}> = ({ media, contacts, contact, message, group }) => {
  let contactName = null;
  if (contact !== null) {
    const [phoneNumber, _] = contact.split("@");
    contactName = contacts[phoneNumber]?.name;  
    if (contactName === undefined) {
      contactName = `+${phoneNumber}`;
    }
  }
  const unexpected = (s: string) => <code className="text-danger fw-bold">{s}</code>;
  let messageBody: React.ReactNode = unexpected("unknown message type");
  if (message.filehash && message.mimetype) {
    const blob = media[message.filehash];
    if (blob) {
      messageBody = <Media mimetype={message.mimetype} blob={blob} />;
    } else {
      messageBody = unexpected(`missing media ${message.mimetype}`);
    }
  } else if (message.msgRow) {
    messageBody = message.msgRow.currentMsg.body;
  }
  return <div id={message.id} className={`message ${contact === null ? "our-message" : "their-message"} ${group ? "group-message" : ""}`}>
    {contactName !== null && <span className="author">{contactName}</span>}
    <span className="time">{renderTime(message.t)}</span>
    <span className="body">
      {messageBody}
    </span>
    <span className="clear" />
  </div>;
};

const ChatInfo: React.FunctionComponent<{
  chat: Chat,
  contacts: {[phoneNumber: string]: Contact},
  groups: {[phoneNumber: string]: Group},
}> = ({ chat, contacts, groups }) => {
  const [phoneNumber, _] = chat.id.split("@");
  let content: React.ReactNode = <>+{phoneNumber}</>;
  const contact = contacts[phoneNumber];
  if (contact) {
    content = <>
      <strong>{contact.name}</strong> (+{phoneNumber})
    </>;
  }
  const group = groups[phoneNumber];
  if (group) {
    content = <><strong>{group.subject}</strong> (group)</>;
  }
  return <div className="chat-info" id={chat.id}>
    {content}
  </div>;
};

const Chat: React.FunctionComponent<{
  contacts: {[phoneNumber: string]: Contact},
  groups: {[phoneNumber: string]: Group},
  media: {[hash: string]: ArrayBuffer},
  messages: Message[],
  chat: Chat,
}> = ({ contacts, groups, chat, media, messages }) => {
  const chatId = chat.id;
  const group = chat.id.includes("g.us");
  const els: React.ReactNode[] = [];
  for (const msg of messages) {
    if (!msg.to || !msg.from) { continue; }
    if (msg.from === chatId) {
      els.push(<ChatMessage
        key={msg.id}
        group={group}
        media={media} contacts={contacts} contact={msg.author ? msg.author._serialized : msg.from} message={msg}
      />
      );
    } else if (msg.to._serialized === chatId) {
      els.push(<ChatMessage key={msg.id} group={group} media={media} contacts={contacts} contact={null} message={msg} />);
    }
  }
  return <>
    <ChatInfo chat={chat} contacts={contacts} groups={groups} />
    <div className="chat-messages">{els}</div>
  </>;
};

export const Viewing: React.FunctionComponent<{ data: WhatsAppData }> = ({ data }) => {
  const contactsByNumber: {[phoneNumber: string]: Contact} = {};
  for (const contact of data["contact.json"]) {
    const [num, _] = contact.id.split("@");
    contactsByNumber[num] = contact;
  }
  const groupsByNumber: {[phoneNumber: string]: Group} = {};
  for (const group of data["group-metadata.json"]) {
    const [num, _] = group.id.split("@");
    groupsByNumber[num] = group;
  }
  const [currentChatId, setCurrentChat] = React.useState<string | null>(null);
  const currentChatIx = data["chat.json"].findIndex(ch => ch.id === currentChatId);
  return <div className="chats">
    <div className="chat-list">
      <div className="list-group">
        {data["chat.json"].map(chat => <a
          className={`list-group-item list-group-item-action ${chat.id === currentChatId ? "active" : ""}`}
          key={chat.id}
          href="#"
          onClick={(ev) => {
            ev.preventDefault();
            setCurrentChat(chat.id);
          }}
        >
          <SidebarChat contacts={contactsByNumber} groups={groupsByNumber} chat={chat} />
        </a>)}
      </div>
    </div>
    {currentChatId !== null &&
      <Chat contacts={contactsByNumber} groups={groupsByNumber} chat={data["chat.json"][currentChatIx]!} media={data.media} messages={data["message.json"]} />}
  </div>;
};
