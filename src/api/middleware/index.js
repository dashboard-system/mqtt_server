const cors = require('cors')
const express = require('express')

function setupMiddleware(app, config, logger) {
  // CORS
  app.use(
    cors({
      origin: config.corsOrigin,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization'],
    }),
  )

  // JSON parsing
  app.use(express.json({ limit: '10mb' }))
  app.use(express.urlencoded({ extended: true }))

  // Request logging
  app.use((req, res, next) => {
    const start = Date.now()

    res.on('finish', () => {
      const duration = Date.now() - start
      logger.info(
        `${req.method} ${req.path} ${res.statusCode} - ${duration}ms`,
        {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
          userAgent: req.get('User-Agent'),
        },
      )
    })

    next()
  })

  // Error handling
  app.use((error, req, res, next) => {
    logger.error('Express error:', error)

    res.status(error.status || 500).json({
      error: 'Internal server error',
      message:
        process.env.NODE_ENV === 'development'
          ? error.message
          : 'Something went wrong',
      timestamp: new Date().toISOString(),
    })
  })
}

module.exports = { setupMiddleware }
