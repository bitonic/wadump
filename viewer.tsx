import * as React from "react";
import * as ReactDOM from "react-dom";

import "./node_modules/bootstrap/dist/css/bootstrap.min.css";

import { Viewing } from "./viewer-ui.tsx";

function impossibleCase<A>(x: never): A {
  throw `Impossible: ${x}`;
}

type TarData = {[fileName: string]: ArrayBufferView | TarData}

// Very poor implementation -- we don't check the checksums or anything.
function untar(blob: ArrayBuffer): TarData {
  const bytes = new Uint8Array(blob);
  const files: TarData = {};
  let cursor = 0;
  while (cursor < blob.byteLength) {
    if (bytes[cursor] === 0) {
      cursor += 512; // skip empty sector
      continue;
    }
    let offset = 0;
    let fileName = "";
    while (bytes[cursor + offset] !== 0) {
      fileName += String.fromCharCode(bytes[cursor + offset]);
      offset++;
    }
    let sizeString = "";
    for (offset = 124; offset < 124 + 11; offset++) {
      sizeString += String.fromCharCode(bytes[cursor + offset]);
    }
    const size = parseInt(sizeString, 8);
    const fileBytes = new Uint8Array(blob, cursor + 512, size);
    cursor += 512 + Math.ceil(size/512)*512;
    // end of parsing, store
    const fileNameSegments = fileName.split("/");
    let currentDirectory = files;
    for (let i = 0; i < fileNameSegments.length - 1; i++) {
      const segment = fileNameSegments[i]; 
      currentDirectory[segment] = currentDirectory[segment] || {};
      currentDirectory = currentDirectory[segment] as TarData;
    }
    currentDirectory[fileNameSegments[fileNameSegments.length-1]] = fileBytes;
  }
  return files;
}

const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

function extractWhatsAppData(tar: TarData): WhatsAppData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const data: any = {};
  for (const name of ["message.json", "contact.json", "group-metadata.json", "chat.json"]) {
    if (tar[name] === undefined) {
      throw `Could not find file ${name} in tar archive.`;
    }
    let str: string | null = null;
    try {
      str = utf8Decoder.decode(tar[name] as unknown as ArrayBuffer);
    } catch (e) {
      console.error(`could not decode utf-8 in file ${name}`, e);
      throw `Could not decode UTF-8 contents of file ${name}`;
    }
    try {
      data[name] = JSON.parse(str);
    } catch (e) {
      console.error(`could not decode json in file ${name}`, e);
      throw `Could not decode JSON in file ${name}`;
    }
  }
  data["media"] = {};
  const typedData = data as WhatsAppData;
  for (const [hash, blob] of Object.entries(tar["media"])) {
    typedData.media[hash.replace(/_/g, "/").replace(/-/g, "+") + "="] = blob;
  }
  const compareTimes = (t1: number | undefined, t2: number | undefined) => {
    if (t1 === t2) { return 0; }
    if (t1 === undefined) { return 1; }
    if (t2 === undefined) { return -1; }
    return t2 - t1;
  };
  typedData["chat.json"].sort((c1, c2) => compareTimes(c1.t, c2.t));
  typedData["message.json"].sort((m1, m2) => compareTimes(m2.t, m1.t));
  console.log(typedData);
  return typedData;
}

type ViewerState =
  | { status: "uploading" }
  | { status: "viewing", data: WhatsAppData }

const Upload: React.FunctionComponent<{ loaded: (data: WhatsAppData) => void }> = ({ loaded }) => {
  const [state, setState] = React.useState<
    { status: "idle" } | { status: "reading" } | { status: "error", error: string }
  >({ status: "idle" });
  return <div className="m-3">
    <form>
      <label htmlFor="whatsapp-dump-upload" className="form-label">
        {state.status === "reading" ?
          <>Reading <code>whatsapp.tar</code>...</> :
          <>Upload <code>whatsapp.tar</code></>}
      </label>
      <input
        className={`form-control ${state.status === "error" ? "is-invalid" : ""}`}
        type="file"
        id="whatsapp-dump-upload"
        onChange={(ev) => {
          setState({ status: "reading" });
          const file = ev.target.files![0];
          const reader = new FileReader();
          reader.onload = (ev) => {
            try {
              const buffer = ev.target!.result as ArrayBuffer;
              const contents = untar(buffer);
              const data = extractWhatsAppData(contents);
              loaded(data);
            } catch (error) {
              console.error("caught error while decoding tar archive", error);
              if (typeof error === "string") {
                setState({ status: "error", error });
              } else {
                setState({ status: "error", error: "Could not decode tar file" });
              }
            }
          };
          reader.readAsArrayBuffer(file);
        }}
        disabled={state.status === "reading"}
      />
      {state.status === "error" &&
        <div className="invalid-feedback">
          {state.error}
        </div>}
    </form>
  </div>;
};

const Viewer: React.FunctionComponent = () => {
  const [viewerState, setViewerState] = React.useState<ViewerState>({ status: "uploading" });
  
  return (
    viewerState.status === "uploading" ?
      <Upload loaded={data => setViewerState({ status: "viewing", data })} /> :
    viewerState.status === "viewing" ?
      <Viewing data={viewerState.data} /> :
    impossibleCase(viewerState)
  );
};

ReactDOM.render(
  <Viewer />,
  document.getElementById("root")
);
