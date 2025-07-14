const winston = require('winston')
const path = require('path')
const fs = require('fs')

class SystemLogger {
  constructor(service = 'UCI-Server') {
    this.service = service
    this.logger = this.createLogger()
  }

  createLogger() {
    // Create logs directory if it doesn't exist
    const logDir = process.env.LOG_DIR || './logs'

    try {
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true })
      }
    } catch (error) {
      console.warn('Could not create log directory:', error.message)
    }

    // Define log format
    const logFormat = winston.format.combine(
      winston.format.timestamp({
        format: 'YYYY-MM-DD HH:mm:ss',
      }),
      winston.format.errors({ stack: true }),
      winston.format.printf(
        ({ timestamp, level, message, service, ...meta }) => {
          let logMessage = `${timestamp} [${level.toUpperCase()}] [${service || this.service}] ${message}`

          // Add metadata if present
          if (Object.keys(meta).length > 0) {
            logMessage += ` ${JSON.stringify(meta)}`
          }

          return logMessage
        },
      ),
    )

    // Get log level from environment
    const logLevel = process.env.LOG_LEVEL || 'info'
    const nodeEnv = process.env.NODE_ENV || 'development'

    // Define transports
    const transports = [
      // Console transport
      new winston.transports.Console({
        level: logLevel,
        format: winston.format.combine(winston.format.colorize(), logFormat),
      }),
    ]

    // Add file transports if not in test environment
    if (nodeEnv !== 'test') {
      transports.push(
        // General log file
        new winston.transports.File({
          filename: path.join(logDir, 'uci-server.log'),
          level: 'info',
          format: logFormat,
          maxsize: 5242880, // 5MB
          maxFiles: 5,
          tailable: true,
        }),

        // Error log file
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
          format: logFormat,
          maxsize: 5242880, // 5MB
          maxFiles: 3,
          tailable: true,
        }),
      )

      // Debug log file (only if debug level enabled)
      if (logLevel === 'debug') {
        transports.push(
          new winston.transports.File({
            filename: path.join(logDir, 'debug.log'),
            level: 'debug',
            format: logFormat,
            maxsize: 10485760, // 10MB
            maxFiles: 2,
            tailable: true,
          }),
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

  info(message, meta = {}) {
    this.logger.info(message, meta)
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
}

module.exports = { SystemLogger }
