const winston = require('winston')
const path = require('path')
const fs = require('fs')
const chalk = require('chalk')

class SystemLogger {
  constructor(service = 'UCI-Server') {
    this.service = service
    this.logger = this.createLogger()
    
    // Enhanced emoji mappings with better categorization
    this.emojis = {
      error: '🚨',
      warn: '⚠️ ',
      info: '💡',
      debug: '🔍',
      verbose: '📝',
      success: '✅',
      mqtt: '📡',
      web: '🌐',
      config: '⚙️ ',
      startup: '🚀',
      shutdown: '🛑',
      database: '💾',
      auth: '🔐',
      network: '🔗',
      system: '💻',
      client: '👤',
      publish: '📤',
      subscribe: '📥',
      file: '📄',
      load: '📂',
      save: '💾'
    }

    // Service-specific emojis with consistent spacing
    this.serviceEmojis = {
      'MQTTServer': '📡',
      'UCIConfigServer': '🎛️ ',
      'UCIManager': '📋',
      'UCIParser': '📄',
      'WebServer': '🌐',
      'SystemLogger': '📝'
    }
  }

  createLogger() {
    const logDir = process.env.LOG_DIR || './logs'

    try {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }
    } catch (error) {
      console.warn('Could not create log directory:', error.message)
    }

    // Enhanced console format with better spacing and alignment
    const consoleFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'HH:mm:ss',
      }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        const emoji = this.getEmojiForLog(level, service, message)
        const serviceEmoji = this.serviceEmojis[service] || this.serviceEmojis[this.service] || '🔧'
        const levelFormatted = this.formatLevel(level)
        const serviceFormatted = this.formatService(service || this.service)
        const messageFormatted = this.formatMessage(message, level)
        
        // Clean timestamp formatting
        const timeFormatted = chalk.gray(`[${timestamp}]`)
        
        // Main log line with better spacing
        let logLine = `${timeFormatted} ${emoji} ${levelFormatted} ${serviceEmoji} ${serviceFormatted} ${messageFormatted}`

        // Clean metadata formatting (exclude standard fields)
        const cleanMeta = this.cleanMetadata(meta)
        if (Object.keys(cleanMeta).length > 0) {
          const metaStr = this.formatMetadata(cleanMeta)
          logLine += `\n${chalk.gray('   └─')} ${metaStr}`
        }

        return logLine
      })
    )

    // File format (clean, no colors)
    const fileFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss',
      }),
      winston.format.errors({ stack: true }),
      winston.format.printf(({ timestamp, level, message, service, ...meta }) => {
        let logMessage = `[${timestamp}] [${level.toUpperCase().padEnd(5)}] [${(service || this.service).padEnd(15)}] ${message}`

        const cleanMeta = this.cleanMetadata(meta)
        if (Object.keys(cleanMeta).length > 0) {
          logMessage += ` | ${JSON.stringify(cleanMeta)}`
        }

        return logMessage
      })
    )

    const logLevel = process.env.LOG_LEVEL || 'info'
    const nodeEnv = process.env.NODE_ENV || 'development'

    const transports = [
      new winston.transports.Console({
        level: logLevel,
        format: consoleFormat,
      }),
    ]

    if (nodeEnv !== 'test') {
      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, 'uci-server.log'),
          level: 'info',
          format: fileFormat,
          maxsize: 5242880,
          maxFiles: 5,
          tailable: true,
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
          format: fileFormat,
          maxsize: 5242880,
          maxFiles: 3,
          tailable: true,
        })
      )

      if (logLevel === 'debug') {
        transports.push(
          new winston.transports.File({
            filename: path.join(logDir, 'debug.log'),
            level: 'debug',
            format: fileFormat,
            maxsize: 10485760,
            maxFiles: 2,
            tailable: true,
          })
        )
      }
    }

    return winston.createLogger({
      level: logLevel,
      defaultMeta: {
        service: this.service,
        environment: nodeEnv,
        pid: process.pid,
      },
      transports,
      exitOnError: false,
    })
  }

  // Enhanced emoji selection with better context awareness
  getEmojiForLog(level, service, message) {
    const msgLower = message.toLowerCase()
    
    // Priority order for message content detection
    if (msgLower.includes('error') || msgLower.includes('failed') || msgLower.includes('denied')) return this.emojis.error
    if (msgLower.includes('warning') || msgLower.includes('warn')) return this.emojis.warn
    
    // Action-based emojis
    if (msgLower.includes('published') || msgLower.includes('publish')) return this.emojis.publish
    if (msgLower.includes('subscribed') || msgLower.includes('subscribe')) return this.emojis.subscribe
    if (msgLower.includes('connected') || msgLower.includes('connection')) return this.emojis.network
    if (msgLower.includes('client')) return this.emojis.client
    
    // State-based emojis
    if (msgLower.includes('started') || msgLower.includes('starting')) return this.emojis.startup
    if (msgLower.includes('stopped') || msgLower.includes('stopping')) return this.emojis.shutdown
    if (msgLower.includes('loaded') || msgLower.includes('load')) return this.emojis.load
    if (msgLower.includes('saved') || msgLower.includes('save')) return this.emojis.save
    if (msgLower.includes('successful') || msgLower.includes('ready')) return this.emojis.success
    
    // Context-based emojis
    if (msgLower.includes('authenticated') || msgLower.includes('auth')) return this.emojis.auth
    if (msgLower.includes('config') || msgLower.includes('uci')) return this.emojis.config
    if (msgLower.includes('file') || msgLower.includes('parsed')) return this.emojis.file
    if (msgLower.includes('web') || msgLower.includes('http')) return this.emojis.web
    
    // Default to log level emoji
    return this.emojis[level] || '📝'
  }

  // Better level formatting with consistent width
  formatLevel(level) {
    const colors = {
      error: chalk.red.bold('ERROR'),
      warn: chalk.yellow.bold('WARN '),
      info: chalk.blue.bold('INFO '),
      debug: chalk.magenta.bold('DEBUG'),
      verbose: chalk.gray.bold('VERB ')
    }
    return colors[level] || chalk.white.bold(level.toUpperCase().padEnd(5))
  }

  // Service name formatting with consistent width and styling
  formatService(serviceName) {
    const maxLength = 15
    const truncated = serviceName.length > maxLength ? 
      serviceName.substring(0, maxLength - 2) + '..' : 
      serviceName
    
    return chalk.cyan(`[${truncated}]`)
  }

  // Enhanced message formatting with context-aware colors
  formatMessage(message, level) {
    const msgLower = message.toLowerCase()
    
    // Error and warning states
    if (level === 'error') return chalk.red(message)
    if (level === 'warn') return chalk.yellow(message)
    
    // Success and positive states
    if (msgLower.includes('started') || msgLower.includes('successful') || 
        msgLower.includes('ready') || msgLower.includes('connected')) {
      return chalk.green(message)
    }
    
    // MQTT operations
    if (msgLower.includes('published')) {
      return chalk.cyan(message.replace(/published/, chalk.bold('published')))
    }
    if (msgLower.includes('subscribed')) {
      return chalk.blue(message.replace(/subscribed/, chalk.bold('subscribed')))
    }
    
    // Client operations
    if (msgLower.includes('client')) {
      return message.replace(/Client/g, chalk.bold.blue('Client'))
    }
    
    // File operations
    if (msgLower.includes('loaded') || msgLower.includes('saved')) {
      return chalk.green(message)
    }
    
    // Configuration operations
    if (msgLower.includes('config') || msgLower.includes('uci')) {
      return chalk.blue(message)
    }
    
    // Default formatting
    return chalk.white(message)
  }

  // Clean metadata by removing standard fields
  cleanMetadata(meta) {
    const cleanMeta = { ...meta }
    const standardFields = ['environment', 'pid', 'nodeEnv', 'logLevel', 'logType', 'service']
    standardFields.forEach(field => delete cleanMeta[field])
    return cleanMeta
  }

  // Format metadata with better readability
  formatMetadata(meta) {
    if (typeof meta === 'object' && meta !== null) {
      const formatted = Object.entries(meta)
        .map(([key, value]) => {
          const keyFormatted = chalk.dim(key + ':')
          const valueFormatted = typeof value === 'string' ? 
            chalk.white(value) : 
            chalk.gray(JSON.stringify(value))
          return `${keyFormatted} ${valueFormatted}`
        })
        .join(chalk.gray(' | '))
      return formatted
    }
    return chalk.gray(JSON.stringify(meta))
  }

  // Standard logging methods
  info(message, meta = {}) {
    this.logger.info(message, meta)
  }

  success(message, meta = {}) {
    this.logger.info(message, { ...meta, logType: 'success' })
  }

  error(message, error = null, meta = {}) {
    if (error instanceof Error) {
      this.logger.error(message, {
        error: {
          message: error.message,
          stack: error.stack,
          name: error.name,
        },
        ...meta,
      })
    } else if (error) {
      this.logger.error(message, { error, ...meta })
    } else {
      this.logger.error(message, meta)
    }
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta)
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta)
  }

  verbose(message, meta = {}) {
    this.logger.verbose(message, meta)
  }

  // Specialized logging methods for better organization
  mqtt(message, meta = {}) {
    this.logger.info(message, { ...meta, logType: 'mqtt' })
  }

  config(message, meta = {}) {
    this.logger.info(message, { ...meta, logType: 'config' })
  }

  auth(message, meta = {}) {
    this.logger.info(message, { ...meta, logType: 'auth' })
  }

  network(message, meta = {}) {
    this.logger.info(message, { ...meta, logType: 'network' })
  }

  startup(message, meta = {}) {
    this.logger.info(message, { ...meta, logType: 'startup' })
  }

  shutdown(message, meta = {}) {
    this.logger.info(message, { ...meta, logType: 'shutdown' })
  }

  // New methods for better categorization
  client(message, meta = {}) {
    this.logger.info(message, { ...meta, logType: 'client' })
  }

  publish(message, meta = {}) {
    this.logger.debug(message, { ...meta, logType: 'publish' })
  }

  subscribe(message, meta = {}) {
    this.logger.debug(message, { ...meta, logType: 'subscribe' })
  }
}

module.exports = { SystemLogger }