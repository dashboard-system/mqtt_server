import Aedes from "aedes";
import { readFileSync } from "fs";
import { createServer } from "net";

const port = 1883;
const options = {
  key: readFileSync("YOUR_PRIVATE_KEY_FILE.pem"),
  cert: readFileSync("YOUR_PUBLIC_CERT_FILE.pem"),
};

const aedes = new Aedes();
//const server = createServer(aedes.handle);
const server = require('tls').createServer(options, aedes.handle)

server.listen(port, function () {
  console.log("server started and listening on port ", port);
});

aedes.on("client", (client) => {
  console.log(`🔌 Client connected: ${client ? client.id : "unknown"}`);
});

aedes.on("clientDisconnect", (client) => {
  console.log(`❌ Client disconnected: ${client ? client.id : "unknown"}`);
});

aedes.on("publish", (packet, client) => {
  if (client) {
    console.log(
      `📨 Message from ${client.id}: ${
        packet.topic
      } => ${packet.payload.toString()}`
    );
  }
});
