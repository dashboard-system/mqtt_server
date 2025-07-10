const express = require('express');
const cors = require('cors');
const mqtt = require('mqtt');
const { SystemLogger } = require('../utils/logger');
const { setupMiddleware } = require('./middleware');
const uciRoutes = require('./routes/uciRoutes');
const systemRoutes = require('./routes/systemRoutes');

class WebServer {
  constructor(config = {}) {
    this.config = {
      port: parseInt(process.env.WEB_PORT) || 3000,
      host: process.env.WEB_HOST || '0.0.0.0',
      mqttUrl: config.mqttUrl || `mqtt://localhost:${process.env.MQTT_PORT || 1883}`,
      corsOrigin: process.env.CORS_ORIGIN || '*',
      ...config
    };
    
    this.logger = new SystemLogger('WebServer');
    this.app = express();
    this.server = null;
    this.mqttClient = null;
    this.isRunning = false;
    
    this.setupApp();
  }

  setupApp() {
    // Setup middleware
    setupMiddleware(this.app, this.config, this.logger);
    
    // Setup routes
    this.app.use('/api/uci', uciRoutes);
    this.app.use('/api/system', systemRoutes);
    this.app.use('/', systemRoutes); // For /health endpoint
    
    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not found',
        path: req.originalUrl,
        message: 'The requested endpoint does not exist'
      });
    });
  }

  async start() {
    try {
      // Connect to MQTT
      await this.connectToMQTT();

      // Make MQTT client available to routes
      this.app.locals.mqttClient = this.mqttClient;
      this.app.locals.logger = this.logger;

      // Start HTTP server
      return new Promise((resolve, reject) => {
        this.server = this.app.listen(this.config.port, this.config.host, (error) => {
          if (error) {
            this.logger.error('Failed to start web server:', error);
            reject(error);
          } else {
            this.isRunning = true;
            this.logger.info(`Web server started on ${this.config.host}:${this.config.port}`);
            resolve();
          }
        });
      });
    } catch (error) {
      this.logger.error('Error starting web server:', error);
      throw error;
    }
  }

  async connectToMQTT() {
    return new Promise((resolve, reject) => {
      this.mqttClient = mqtt.connect(this.config.mqttUrl, {
        clientId: 'UCI_WEB_SERVER',
        clean: true,
        connectTimeout: 5000,
        reconnectPeriod: 1000
      });

      this.mqttClient.on('connect', () => {
        this.logger.info('Web server connected to MQTT');
        
        // Subscribe to topics for real-time data
        this.mqttClient.subscribe('config/+/+/+');
        this.mqttClient.subscribe('system/+');
        
        resolve();
      });

      this.mqttClient.on('error', (error) => {
        this.logger.error('MQTT connection error:', error);
        reject(error);
      });
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      mqttConnected: this.mqttClient ? this.mqttClient.connected : false
    };
  }

  async stop() {
    this.logger.info('Stopping web server...');
    
    if (this.mqttClient) {
      this.mqttClient.end();
    }
    
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.isRunning = false;
          this.logger.info('Web server stopped');
          resolve();
        });
      });
    }
  }
}

module.exports = { WebServer };