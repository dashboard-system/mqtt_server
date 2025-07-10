const express = require('express');
const router = express.Router();

// Health check endpoint
router.get('/health', (req, res) => {
  const mqttClient = req.app.locals.mqttClient;
  
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    mqtt: {
      connected: mqttClient ? mqttClient.connected : false
    },
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: '1.0.0'
  });
});

// System status endpoint
router.get('/status', (req, res) => {
  const mqttClient = req.app.locals.mqttClient;
  
  const status = {
    server: {
      isRunning: true,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      environment: process.env.NODE_ENV || 'development',
      nodeVersion: process.version,
      pid: process.pid
    },
    mqtt: {
      connected: mqttClient ? mqttClient.connected : false,
      url: process.env.MQTT_PORT ? `mqtt://localhost:${process.env.MQTT_PORT}` : 'mqtt://localhost:1883'
    },
    config: {
      webPort: process.env.WEB_PORT || 3000,
      mqttPort: process.env.MQTT_PORT || 1883,
      logLevel: process.env.LOG_LEVEL || 'info',
      nodeEnv: process.env.NODE_ENV || 'development'
    },
    timestamp: new Date().toISOString()
  };
  
  res.json(status);
});

module.exports = router;