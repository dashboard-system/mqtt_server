// Load environment variables first
require('dotenv').config();

const { MQTTServer } = require('./mqtt/mqttServer');
const { UCIManager } = require('./uci/uciManager');
const { WebServer } = require('./api/webServer');
const { SystemLogger } = require('./utils/logger');

class UCIConfigurationServer {
  constructor() {
    this.logger = new SystemLogger('UCIConfigServer');
    this.mqttServer = null;
    this.uciManager = null;
    this.webServer = null;
    this.isRunning = false;
  }

  async initialize() {
    try {
      this.logger.info('Starting UCI Configuration Server...', {
        nodeEnv: process.env.NODE_ENV,
        logLevel: process.env.LOG_LEVEL
      });

      // Initialize MQTT Server with env config
      this.mqttServer = new MQTTServer({
        port: parseInt(process.env.MQTT_PORT) || 1883,
        wsPort: parseInt(process.env.MQTT_WS_PORT) || 8883,
        host: process.env.MQTT_HOST || '0.0.0.0'
      });

      // Initialize UCI Manager with env config
      this.uciManager = new UCIManager({
        uciDirectory: process.env.UCI_DIR || './uci',
        backupDirectory: process.env.BACKUP_DIR || './uci_backup',
        uuidMappingFile: process.env.UUID_MAPPING_FILE || './uci_uuid_mapping.json',
        writeUuidsToFiles: process.env.WRITE_UUIDS_TO_FILES !== 'false'
      });

      // Initialize Web Server
      this.webServer = new WebServer({
        mqttUrl: `mqtt://localhost:${process.env.MQTT_PORT || 1883}`
      });

      // Start MQTT server
      await this.mqttServer.start();

      // Wait for MQTT internal client to be ready
      await this.waitForMQTTClient();

      // Initialize UCI Manager (loads files)
      await this.uciManager.initialize();

      // Connect UCI Manager to MQTT and publish files
      await this.uciManager.connectToMQTT(this.mqttServer.getClient());

      // Start Web Server
      await this.webServer.start();

      this.setupGracefulShutdown();
      this.isRunning = true;

      this.logger.info('UCI Configuration Server started successfully');
      this.logger.info(`MQTT Server: ${this.mqttServer.config.host}:${this.mqttServer.config.port}`);
      this.logger.info(`MQTT WebSocket: ${this.mqttServer.config.host}:${this.mqttServer.config.wsPort}`);
      this.logger.info(`Web Server: http://${this.webServer.config.host}:${this.webServer.config.port}`);
      this.logger.info(`UCI Files: ${this.uciManager.getStatus().filesLoaded} files, ${this.uciManager.getStatus().totalSections} sections`);
      this.logger.info(`Environment: ${process.env.NODE_ENV || 'development'}`);

    } catch (error) {
      this.logger.error('Failed to start server:', error);
      process.exit(1);
    }
  }

  async waitForMQTTClient() {
    this.logger.info('Waiting for MQTT internal client to be ready...');
    
    return new Promise((resolve, reject) => {
      const maxWait = parseInt(process.env.MQTT_CLIENT_TIMEOUT) || 10000;
      const checkInterval = 100;
      let waited = 0;
      
      const checkClient = () => {
        const client = this.mqttServer.getClient();
        
        if (client && client.connected) {
          this.logger.info('MQTT internal client is ready');
          resolve();
          return;
        }
        
        waited += checkInterval;
        if (waited >= maxWait) {
          reject(new Error('MQTT internal client failed to connect within timeout'));
          return;
        }
        
        setTimeout(checkClient, checkInterval);
      };
      
      setTimeout(checkClient, 1000);
    });
  }

  setupGracefulShutdown() {
    const shutdown = async (signal) => {
      this.logger.info(`Received ${signal}, shutting down gracefully...`);
      
      if (this.webServer) {
        await this.webServer.stop();
      }
      
      if (this.uciManager) {
        await this.uciManager.shutdown();
      }
      
      if (this.mqttServer) {
        await this.mqttServer.stop();
      }
      
      this.logger.info('Server shutdown complete');
      process.exit(0);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      environment: process.env.NODE_ENV || 'development',
      mqtt: this.mqttServer ? this.mqttServer.getStatus() : null,
      uci: this.uciManager ? this.uciManager.getStatus() : null,
      web: this.webServer ? this.webServer.getStatus() : null
    };
  }
}

// Start the server
const server = new UCIConfigurationServer();
server.initialize().catch(console.error);

module.exports = UCIConfigurationServer;