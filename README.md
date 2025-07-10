# MQTT UCI Configuration Server

A comprehensive MQTT-based configuration management system for UCI (Unified Configuration Interface) files. This server provides real-time configuration management through both MQTT messaging and REST API endpoints, with persistent UUID tracking and automatic file synchronization.

## 🚀 Features

- **MQTT Broker**: Built-in MQTT broker with WebSocket support
- **UCI File Management**: Automatic parsing, validation, and publishing of UCI configurations
- **REST API**: Full CRUD operations for UCI sections
- **Real-time Updates**: Live configuration changes via MQTT with retained messages
- **Persistent UUIDs**: Consistent section identification across restarts
- **File Watching**: Automatic reload when UCI files change on disk
- **Automatic Backups**: File versioning before modifications
- **WebSocket Support**: MQTT over WebSocket for web applications
- **Environment Configuration**: Flexible configuration via environment variables

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Installation](#installation)
- [Configuration](#configuration)
- [API Documentation](#api-documentation)
- [MQTT Topics](#mqtt-topics)
- [UCI File Format](#uci-file-format)
- [Architecture](#architecture)
- [Development](#development)
- [Examples](#examples)

## 🏃‍♂️ Quick Start

```bash
# Clone and install
git clone <repository>
cd mqtt-uci-server
npm install

# Start the server
npm start
```

**Access Points:**
- **MQTT**: `mqtt://localhost:1883`
- **MQTT WebSocket**: `ws://localhost:8883`
- **REST API**: `http://localhost:3000`
- **Health Check**: `http://localhost:3000/health`

## 💻 Installation

### Prerequisites
- Node.js 16+ 
- npm 7+

### Setup
```bash
# Install dependencies
npm install

# Create required directories (automatic on first run)
mkdir -p uci uci_backup logs

# Copy your UCI files to ./uci/ directory
cp /etc/config/* ./uci/

# Start the server
npm start
```

## ⚙️ Configuration

Configure the server using environment variables in `.env`:

```bash
# Server Configuration
NODE_ENV=development
LOG_LEVEL=debug

# MQTT Configuration
MQTT_HOST=0.0.0.0
MQTT_PORT=1883
MQTT_WS_PORT=8883

# Web Server Configuration
WEB_PORT=3000
CORS_ORIGIN=*

# UCI Configuration
UCI_DIR=./uci
BACKUP_DIR=./uci_backup
WRITE_UUIDS_TO_FILES=true

# Logging
LOG_DIR=./logs
```

### Configuration Options

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | `development` | Environment mode (development/production) |
| `LOG_LEVEL` | `info` | Logging level (error/warn/info/debug) |
| `MQTT_HOST` | `0.0.0.0` | MQTT broker bind address |
| `MQTT_PORT` | `1883` | MQTT broker port |
| `MQTT_WS_PORT` | `8883` | MQTT WebSocket port |
| `WEB_PORT` | `3000` | REST API port |
| `UCI_DIR` | `./uci` | UCI files directory |
| `BACKUP_DIR` | `./uci_backup` | Backup files directory |
| `WRITE_UUIDS_TO_FILES` | `true` | Write UUIDs to UCI files |

## 📚 API Documentation

### Health & System

#### Health Check
```http
GET /health
```
Returns server health status and basic metrics.

#### System Status
```http
GET /api/system/status
```
Returns detailed system information including MQTT status, memory usage, and configuration.

### UCI Files

#### List UCI Files
```http
GET /api/uci/files
```
Returns list of all available UCI configuration files.

**Response:**
```json
{
  "files": ["network", "wireless", "firewall"],
  "count": 3,
  "timestamp": "2025-01-10T12:00:00.000Z"
}
```

#### Get All Sections in File
```http
GET /api/uci/files/{fileName}
```
Returns all sections in the specified UCI file.

#### Get Sections by Type
```http
GET /api/uci/files/{fileName}/{sectionName}
```
Returns all sections of a specific type (e.g., all interfaces).

**Example:**
```http
GET /api/uci/files/network/interface
```

#### Get Specific Section
```http
GET /api/uci/files/{fileName}/{sectionName}/{uuid}
```
Returns a specific UCI section by UUID.

**Response:**
```json
{
  "fileName": "network",
  "sectionName": "interface", 
  "uuid": "12345678-1234-1234-1234-123456789abc",
  "section": {
    "uuid": "12345678-1234-1234-1234-123456789abc",
    "sectionType": "interface",
    "sectionName": "lan",
    "fileName": "network",
    "values": {
      "proto": "static",
      "ifname": "eth0",
      "ipaddr": "192.168.1.1",
      "netmask": "255.255.255.0",
      "dns": ["8.8.8.8", "8.8.4.4"]
    },
    "lastModified": "2025-01-10T12:00:00.000Z"
  }
}
```

### UCI Management

#### Create New Section
```http
POST /api/uci/files/{fileName}/{sectionName}
Content-Type: application/json

{
  "values": {
    "proto": "static",
    "ifname": "eth2", 
    "ipaddr": "192.168.2.1",
    "netmask": "255.255.255.0"
  }
}
```

#### Update Section
```http
PUT /api/uci/files/{fileName}/{sectionName}/{uuid}
Content-Type: application/json

{
  "values": {
    "ipaddr": "192.168.1.100"
  }
}
```

#### Delete Section
```http
DELETE /api/uci/files/{fileName}/{sectionName}/{uuid}
```

#### Reload UCI File
```http
POST /api/uci/reload/{fileName}
```
Reloads the UCI file from disk and republishes to MQTT.

## 📡 MQTT Topics

### Configuration Topics
All UCI sections are published to retained topics following this pattern:

```
config/{fileName}/{sectionType}/{uuid}
```

**Examples:**
- `config/network/interface/12345678-1234-1234-1234-123456789abc`
- `config/wireless/wifi-device/87654321-4321-4321-4321-cba987654321`
- `config/firewall/rule/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`

**Message Format:**
```json
{
  "uuid": "12345678-1234-1234-1234-123456789abc",
  "sectionType": "interface",
  "sectionName": "lan",
  "fileName": "network", 
  "values": {
    "proto": "static",
    "ifname": "eth0",
    "ipaddr": "192.168.1.1",
    "netmask": "255.255.255.0",
    "dns": ["8.8.8.8", "8.8.4.4"]
  },
  "lastModified": "2025-01-10T12:00:00.000Z"
}
```

### Command Topics

#### Edit Commands
```
commands/edit
```
Send UCI modification commands:

```json
{
  "action": "create|update|delete",
  "fileName": "network",
  "sectionName": "interface",
  "uuid": "12345678-1234-1234-1234-123456789abc",
  "values": {
    "ipaddr": "192.168.1.200"
  },
  "requestId": "req_12345",
  "timestamp": "2025-01-10T12:00:00.000Z"
}
```

#### Reload Commands
```
commands/reload
```
Reload UCI files:

```json
{
  "fileName": "network",
  "timestamp": "2025-01-10T12:00:00.000Z"
}
```

#### Command Responses
```
commands/response/{requestId}
```
Receive command execution results:

```json
{
  "requestId": "req_12345",
  "status": "success|error",
  "message": "Section updated successfully",
  "data": {
    "fileName": "network",
    "sectionName": "interface",
    "uuid": "12345678-1234-1234-1234-123456789abc"
  },
  "timestamp": "2025-01-10T12:00:00.000Z"
}
```

### System Topics

#### System Status
```
system/status
```
File operation status updates.

#### Server Startup
```
system/startup
```
Server initialization information.

## 📄 UCI File Format

UCI files are automatically enhanced with UUIDs:

**Before:**
```
config interface 'lan'
	option proto 'static'
	option ifname 'eth0'
	option ipaddr '192.168.1.1'
	list dns '8.8.8.8'
	list dns '8.8.4.4'
```

**After:**
```
config interface 'lan'
	option uuid '12345678-1234-1234-1234-123456789abc'
	option proto 'static'
	option ifname 'eth0'
	option ipaddr '192.168.1.1'
	list dns '8.8.8.8'
	list dns '8.8.4.4'
```

### Supported UCI Elements
- **Sections**: `config <type> ['<name>']`
- **Options**: `option <key> <value>`
- **Lists**: `list <key> <value>`
- **Comments**: `# comment` (preserved)

## 🏗️ Architecture

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Web Clients   │    │  MQTT Clients   │    │   UCI Files     │
│  (REST API)     │    │   (IoT/Apps)    │    │  (File System)  │
└─────┬───────────┘    └─────┬───────────┘    └─────┬───────────┘
      │                      │                      │
      │ HTTP                 │ MQTT                 │ File I/O
      │                      │                      │
┌─────▼──────────────────────▼──────────────────────▼───────────┐
│                UCI Configuration Server                       │
├───────────────────────────────────────────────────────────────┤
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐ │
│  │ Web Server  │  │ MQTT Broker │  │    UCI Manager          │ │
│  │ (Express)   │  │   (Aedes)   │  │ (File Parser/Writer)    │ │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘ │
│           │              │                     │               │
│           └──────────────┼─────────────────────┘               │
│                          │                                     │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              Shared MQTT Client                        │   │
│  └─────────────────────────────────────────────────────────┘   │
└───────────────────────────────────────────────────────────────┘
```

### Components

- **MQTT Broker**: Handles pub/sub messaging with WebSocket support
- **UCI Manager**: Parses UCI files, manages UUIDs, handles file I/O
- **Web Server**: Provides REST API endpoints
- **UCI Parser**: Converts between UCI format and JSON
- **Logger**: Structured logging with multiple levels

## 🛠️ Development

### Project Structure
```
mqtt-uci-server/
├── src/
│   ├── server.js              # Main application entry point
│   ├── mqtt/
│   │   └── mqttServer.js      # MQTT broker implementation
│   ├── uci/
│   │   ├── uciManager.js      # UCI file management
│   │   └── uciParser.js       # UCI format parser
│   ├── api/
│   │   ├── webServer.js       # Express server setup
│   │   ├── middleware/
│   │   │   └── index.js       # Common middleware
│   │   ├── routes/
│   │   │   ├── uciRoutes.js   # UCI endpoints
│   │   │   └── systemRoutes.js # System endpoints  
│   │   └── services/
│   │       └── uciService.js  # Business logic
│   └── utils/
│       └── logger.js          # Logging utilities
├── uci/                       # UCI configuration files
├── uci_backup/               # Automatic backups
├── logs/                     # Log files
├── package.json
├── .env                      # Environment configuration
└── README.md
```

### Scripts
```bash
npm start          # Start production server
npm run dev        # Start development server with nodemon
npm run setup      # Create directories and example files
npm test           # Run tests (when implemented)
```

### Adding New Features

1. **New API Endpoints**: Add routes in `src/api/routes/`
2. **Business Logic**: Extend `src/api/services/uciService.js`
3. **UCI Processing**: Modify `src/uci/uciParser.js`
4. **MQTT Features**: Extend `src/mqtt/mqttServer.js`

## 📖 Examples

### MQTT Client (Node.js)
```javascript
const mqtt = require('mqtt');
const client = mqtt.connect('mqtt://localhost:1883');

client.on('connect', () => {
  // Subscribe to all network interfaces
  client.subscribe('config/network/interface/+');
  
  // Subscribe to system status
  client.subscribe('system/status');
});

client.on('message', (topic, message) => {
  const data = JSON.parse(message.toString());
  console.log(`Received update on ${topic}:`, data);
});

// Send update command
const updateCommand = {
  action: 'update',
  fileName: 'network',
  sectionName: 'interface', 
  uuid: '12345678-1234-1234-1234-123456789abc',
  values: { ipaddr: '192.168.1.150' },
  requestId: 'req_' + Date.now()
};

client.publish('commands/edit', JSON.stringify(updateCommand));
```

### Web Application (JavaScript)
```javascript
// REST API usage
const baseUrl = 'http://localhost:3000';

// Get all network interfaces
fetch(`${baseUrl}/api/uci/files/network/interface`)
  .then(response => response.json())
  .then(data => console.log('Interfaces:', data.sections));

// Update an interface
fetch(`${baseUrl}/api/uci/files/network/interface/${uuid}`, {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    values: { ipaddr: '192.168.1.200' }
  })
})
.then(response => response.json())
.then(data => console.log('Update result:', data));
```

### MQTT over WebSocket (Browser)
```html
<script src="https://unpkg.com/mqtt/dist/mqtt.min.js"></script>
<script>
const client = mqtt.connect('ws://localhost:8883');

client.on('connect', () => {
  client.subscribe('config/+/+/+');
});

client.on('message', (topic, message) => {
  const config = JSON.parse(message.toString());
  updateUI(topic, config);
});
</script>
```

## 🐳 Docker Support

```bash
# Build and run with Docker Compose
docker-compose up -d

# Or build manually
docker build -t mqtt-uci-server .
docker run -p 1883:1883 -p 3000:3000 -p 8883:8883 mqtt-uci-server
```

## 📝 License

MIT License - see [LICENSE](LICENSE) file for details.

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## 🆘 Support

- **Issues**: [GitHub Issues](https://github.com/your-repo/issues)
- **Documentation**: This README and inline code comments
- **Examples**: See `examples/` directory

## 🔄 Changelog

### v1.0.0
- Initial release
- MQTT broker with WebSocket support
- REST API for UCI management
- Persistent UUID system
- Automatic file backup
- Real-time configuration sync