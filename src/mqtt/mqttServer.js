const fs = require('fs')
const aedes = require('aedes')
const { createServer } = require('net')
const { createServer: createHttpServer } = require('http')
const ws = require('websocket-stream')
const mqtt = require('mqtt')
const crypto = require('crypto')
const { SystemLogger } = require('../utils/logger')
const { defaultUsers, defaultAcl } = require('../default')
require('dotenv').config({ path: './.env' })

class MQTTServer {
  constructor(config = {}) {
    this.config = {
      port: config.port || 1883,
      wsPort: config.wsPort || 8883,
      host: config.host || '0.0.0.0',
      enableAuth: process.env.MQTT_ENABLE_AUTH === 'true',
      aclFile: process.env.MQTT_ACL_FILE || './mqtt_acl.json',
      usersFile: process.env.MQTT_USERS_FILE || './mqtt_users.json',
      ...config,
    }

    this.logger = new SystemLogger('MQTTServer')
    this.broker = null
    this.server = null
    this.wsServer = null
    this.internalClient = null
    this.isRunning = false
    this.users = new Map()
    this.acl = []
  }

  async start() {
    try {
      // Load authentication and ACL data
      if (this.config.enableAuth) {
        await this.loadUsers()
        await this.loadACL()
      }

      // Create Aedes broker configuration
      const aedesConfig = {
        id: 'UCI_MQTT_BROKER',
        heartbeatInterval: 30000,
        connectTimeout: 30000,
      }

      // Only add auth functions if authentication is enabled
      if (this.config.enableAuth) {
        aedesConfig.authenticate = this.authenticate.bind(this)
        aedesConfig.authorizePublish = this.authorizePublish.bind(this)
        aedesConfig.authorizeSubscribe = this.authorizeSubscribe.bind(this)
      }

      // Create Aedes broker instance
      this.broker = aedes(aedesConfig)

      // Setup broker event handlers
      this.setupBrokerHandlers()

      // Create TCP server for MQTT
      this.server = createServer(this.broker.handle)

      // Create WebSocket server for MQTT over WebSocket
      const httpServer = createHttpServer()
      this.wsServer = ws.createServer(
        { server: httpServer },
        this.broker.handle,
      )

      // Start both servers
      await this.startTcpServer()
      await this.startWebSocketServer(httpServer)

      this.isRunning = true
      this.logger.info(
        `MQTT broker started on ${this.config.host}:${this.config.port}`,
      )
      this.logger.info(
        `MQTT WebSocket server started on ${this.config.host}:${this.config.wsPort}`,
      )

      if (this.config.enableAuth) {
        this.logger.info(
          `Authentication enabled with ${this.users.size} users and ${this.acl.length} ACL rules`,
        )
      } else {
        this.logger.warn(
          'Authentication DISABLED - server is open to all connections',
        )
      }

      // Create internal client for system operations
      setTimeout(() => {
        this.createInternalClient()
      }, 1000)
    } catch (error) {
      this.logger.error('Error starting MQTT server:', error)
      throw error
    }
  }

  async loadUsers() {
    try {
      if (fs.existsSync(this.config.usersFile)) {
        const usersData = JSON.parse(
          fs.readFileSync(this.config.usersFile, 'utf8'),
        )
        this.users = new Map(Object.entries(usersData))
        this.logger.info(
          `Loaded ${this.users.size} MQTT users from ${this.config.usersFile}`,
        )
      } else {
        fs.writeFileSync(
          this.config.usersFile,
          JSON.stringify(defaultUsers, null, 2),
        )
        this.users = new Map(Object.entries(defaultUsers))
        this.logger.info(
          `Created default users file with ${this.users.size} users`,
        )
      }
    } catch (error) {
      this.logger.error('Error loading users:', error)
      this.users = new Map()
    }
  }

  async loadACL() {
    try {
      if (fs.existsSync(this.config.aclFile)) {
        this.acl = JSON.parse(fs.readFileSync(this.config.aclFile, 'utf8'))
        this.logger.info(
          `Loaded ${this.acl.length} ACL rules from ${this.config.aclFile}`,
        )
      } else {
        // Create default ACL file
        this.acl = defaultAcl
        fs.writeFileSync(this.config.aclFile, JSON.stringify(this.acl, null, 2))
        this.logger.info(
          `Created default ACL file with ${this.acl.length} rules`,
        )
      }
    } catch (error) {
      this.logger.error('Error loading ACL:', error)
      this.acl = []
    }
  }

  hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex')
  }

  authenticate(client, username, password, callback) {
    if (!username || !password) {
      this.logger.warn(
        `Authentication failed: Missing credentials from ${client.id}`,
      )
      return callback(null, false)
    }

    const user = this.users.get(username)
    if (!user) {
      this.logger.warn(
        `Authentication failed: Unknown user '${username}' from ${client.id}`,
      )
      return callback(null, false)
    }

    const hashedPassword = this.hashPassword(password.toString())
    if (user.password !== hashedPassword) {
      this.logger.warn(
        `Authentication failed: Invalid password for '${username}' from ${client.id}`,
      )
      return callback(null, false)
    }

    // Store user info in client for ACL checks
    client.user = {
      username: username,
      roles: user.roles || [],
      allowAll: user.allowAll || false,
    }

    this.logger.info(
      `Authentication successful: '${username}' [${user.roles.join(
        ', ',
      )}] from ${client.id}`,
    )
    callback(null, true)
  }

  authorizePublish(client, packet, callback) {
    const topic = packet.topic
    const allowed = this.checkTopicPermission(client, topic, 'publish')

    if (allowed) {
      this.logger.debug(
        `Publish authorized: ${client.user?.username} -> ${topic}`,
      )
      callback(null)
    } else {
      this.logger.warn(
        `Publish denied: ${client.user?.username || 'anonymous'} -> ${topic}`,
      )
      callback(new Error('Publish not authorized'))
    }
  }

  authorizeSubscribe(client, sub, callback) {
    const topic = sub.topic
    const allowed = this.checkTopicPermission(client, topic, 'subscribe')

    if (allowed) {
      this.logger.debug(
        `Subscribe authorized: ${client.user?.username} -> ${topic}`,
      )
      callback(null, sub)
    } else {
      this.logger.warn(
        `Subscribe denied: ${client.user?.username || 'anonymous'} -> ${topic}`,
      )
      callback(new Error('Subscribe not authorized'))
    }
  }

  checkTopicPermission(client, topic, action) {
    // Deny if no user info (shouldn't happen after authentication)
    if (!client.user) {
      return false
    }

    // Allow if user has allowAll permission
    if (client.user.allowAll) {
      return true
    }

    // Check ACL rules for user's roles
    for (const role of client.user.roles) {
      const roleRule = this.acl.find((rule) => rule.role === role)
      if (roleRule) {
        // Check deny rules first
        if (roleRule.deny) {
          for (const denyRule of roleRule.deny) {
            if (
              this.topicMatches(denyRule.topic, topic) &&
              denyRule.action.includes(action)
            ) {
              return false
            }
          }
        }

        // Check allow rules
        if (roleRule.allow) {
          for (const allowRule of roleRule.allow) {
            if (
              this.topicMatches(allowRule.topic, topic) &&
              allowRule.action.includes(action)
            ) {
              return true
            }
          }
        }
      }
    }

    return false
  }

  startTcpServer() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, (error) => {
        if (error) {
          this.logger.error('Failed to start MQTT TCP server:', error)
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  startWebSocketServer(httpServer) {
    return new Promise((resolve, reject) => {
      httpServer.listen(this.config.wsPort, this.config.host, (error) => {
        if (error) {
          this.logger.error('Failed to start MQTT WebSocket server:', error)
          reject(error)
        } else {
          resolve()
        }
      })
    })
  }

  setupBrokerHandlers() {
    // Client connection handler
    this.broker.on('client', (client) => {
      const userInfo = client.user ? `[${client.user.username}]` : '[anonymous]'
      this.logger.info(`Client connected: ${client.id} ${userInfo}`)
    })

    // Client disconnection handler
    this.broker.on('clientDisconnect', (client) => {
      const userInfo = client.user ? `[${client.user.username}]` : '[anonymous]'
      this.logger.info(`Client disconnected: ${client.id} ${userInfo}`)
    })

    // Message publication handler
    this.broker.on('publish', (packet, client) => {
      if (client && packet.topic !== '$SYS/broker/heartbeat') {
        const userInfo = client.user
          ? `[${client.user.username}]`
          : '[anonymous]'
        this.logger.debug(
          `Message published by ${client.id} ${userInfo} to ${packet.topic}`,
        )
      }
    })

    // Subscription handler
    this.broker.on('subscribe', (subscriptions, client) => {
      const userInfo = client.user ? `[${client.user.username}]` : '[anonymous]'
      this.logger.debug(
        `Client ${client.id} ${userInfo} subscribed to:`,
        subscriptions.map((s) => s.topic),
      )
    })

    // Error handler
    this.broker.on('error', (error) => {
      this.logger.error('MQTT broker error:', error)
    })
  }

  createInternalClient() {
    const internalAuth = this.config.enableAuth
      ? {
          username: 'uci_internal',
          password: 'internal123',
        }
      : {}

    this.internalClient = mqtt.connect(`mqtt://127.0.0.1:${this.config.port}`, {
      clientId: 'UCI_INTERNAL_CLIENT',
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 1000,
      ...internalAuth,
    })

    this.internalClient.on('connect', () => {
      this.logger.info('Internal MQTT client connected')
    })

    this.internalClient.on('error', (error) => {
      this.logger.error('Internal MQTT client error:', error)
    })

    this.internalClient.on('offline', () => {
      this.logger.warn('Internal MQTT client offline')
    })
  }

  getClient() {
    return this.internalClient
  }

  async publish(topic, message, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.internalClient || !this.internalClient.connected) {
        // If internal client not ready, publish directly through broker
        const payload =
          typeof message === 'string' ? message : JSON.stringify(message)
        const packet = {
          cmd: 'publish',
          topic: topic,
          payload: payload,
          qos: options.qos || 0,
          retain: options.retain || false,
        }

        this.broker.publish(packet, () => {
          this.logger.debug(`Published to ${topic} via broker`)
          resolve()
        })
        return
      }

      // IMPORTANT: Always ensure payload is a string
      const payload =
        typeof message === 'string' ? message : JSON.stringify(message)

      this.internalClient.publish(
        topic,
        payload,
        {
          qos: options.qos || 0,
          retain: options.retain || false,
          ...options,
        },
        (error) => {
          if (error) {
            this.logger.error(`Failed to publish to ${topic}:`, error)
            reject(error)
          } else {
            this.logger.debug(
              `Published to ${topic}: ${payload.substring(0, 100)}...`,
            )
            resolve()
          }
        },
      )
    })
  }

  topicMatches(pattern, topic) {
    const patternParts = pattern.split('/')
    const topicParts = topic.split('/')

    if (pattern === '#') return true
    if (pattern === topic) return true

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] === '#') {
        return true
      }
      if (patternParts[i] === '+') {
        continue
      }
      if (patternParts[i] !== topicParts[i]) {
        return false
      }
    }

    return patternParts.length === topicParts.length
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      connectedClients: this.broker
        ? Object.keys(this.broker.clients).length
        : 0,
      internalClientConnected: this.internalClient
        ? this.internalClient.connected
        : false,
      authenticationEnabled: this.config.enableAuth,
      totalUsers: this.users.size,
      aclRules: this.acl.length,
    }
  }

  async stop() {
    this.logger.info('Stopping MQTT server...')

    if (this.internalClient) {
      this.internalClient.end()
    }

    if (this.wsServer) {
      this.wsServer.close()
    }

    if (this.broker) {
      this.broker.close()
    }

    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.isRunning = false
          this.logger.info('MQTT server stopped')
          resolve()
        })
      })
    }
  }
}

module.exports = { MQTTServer }
