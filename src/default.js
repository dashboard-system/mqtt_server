const crypto = require('crypto')

// Create default users file
const defaultUsers = {
  admin: {
    password: crypto.createHash('sha256').update('admin123').digest('hex'),
    roles: ['admin'],
    allowAll: true,
  },
  client: {
    password: crypto.createHash('sha256').update('client123').digest('hex'),
    roles: ['client'],
    allowAll: false,
  },
  uci_internal: {
    password: crypto.createHash('sha256').update('internal123').digest('hex'),
    roles: ['internal'],
    allowAll: true,
  },
}

const defaultAcl = [
  {
    role: 'admin',
    allow: [{ topic: '#', action: ['publish', 'subscribe'] }],
  },
  {
    role: 'internal',
    allow: [
      { topic: 'config/#', action: ['publish', 'subscribe'] },
      { topic: 'system/#', action: ['publish', 'subscribe'] },
      { topic: 'commands/#', action: ['publish', 'subscribe'] },
    ],
  },
  {
    role: 'client',
    allow: [
      { topic: 'config/+/+/+', action: ['subscribe'] },
      { topic: 'system/status', action: ['subscribe'] },
      { topic: 'commands/edit', action: ['publish'] },
      { topic: 'commands/reload', action: ['publish'] },
    ],
    deny: [{ topic: 'system/startup', action: ['publish'] }],
  },
]

const defaultMqttServer = {
  port: 1883,
  wsPort: 8883,
  host: '0.0.0.0',
  environment: 'development',
}

const defaultServerDir = {
  uci: './uci',
  uciBackup: './uci_backup',
  uuidMap: './uci_uuid_mapping.json',
}

const defaultUciHandleWebServer = {
  port: 3001,
  host: '0.0.0.0',
  corsOrigin: '*',
}
module.exports = {
  defaultUsers,
  defaultAcl,
  defaultMqttServer,
  defaultServerDir,
  defaultUciHandleWebServer,
}
