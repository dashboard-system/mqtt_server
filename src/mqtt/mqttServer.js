const aedes = require('aedes');
const { createServer } = require('net');
const { createServer: createHttpServer } = require('http');
const ws = require('ws');
const mqtt = require('mqtt');
const { SystemLogger } = require('../utils/logger');

class MQTTServer {
  constructor(config = {}) {
    this.config = {
      port: config.port || 1883,
      wsPort: config.wsPort || 8883,
      host: config.host || '0.0.0.0',
      ...config
    };
    
    this.logger = new SystemLogger('MQTTServer');
    this.broker = null;
    this.server = null;
    this.wsServer = null;
    this.internalClient = null;
    this.isRunning = false;
  }

  async start() {
    try {
      // Create Aedes broker instance
      this.broker = aedes({
        id: 'UCI_MQTT_BROKER',
        heartbeatInterval: 30000,
        connectTimeout: 30000
      });

      // Setup broker event handlers
      this.setupBrokerHandlers();

      // Create TCP server for MQTT
      this.server = createServer(this.broker.handle);
      
      // Create WebSocket server for MQTT over WebSocket
      const httpServer = createHttpServer();
      this.wsServer = new ws.Server({ server: httpServer });
      this.wsServer.on('connection', this.broker.handle);

      // Start both servers
      await this.startTcpServer();
      await this.startWebSocketServer(httpServer);

      this.isRunning = true;
      this.logger.info(`MQTT broker started on ${this.config.host}:${this.config.port}`);
      this.logger.info(`MQTT WebSocket server started on ${this.config.host}:${this.config.wsPort}`);
      
      // Create internal client for system operations
      setTimeout(() => {
        this.createInternalClient();
      }, 1000);

    } catch (error) {
      this.logger.error('Error starting MQTT server:', error);
      throw error;
    }
  }

  startTcpServer() {
    return new Promise((resolve, reject) => {
      this.server.listen(this.config.port, this.config.host, (error) => {
        if (error) {
          this.logger.error('Failed to start MQTT TCP server:', error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  startWebSocketServer(httpServer) {
    return new Promise((resolve, reject) => {
      httpServer.listen(this.config.wsPort, this.config.host, (error) => {
        if (error) {
          this.logger.error('Failed to start MQTT WebSocket server:', error);
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  setupBrokerHandlers() {
    // Client connection handler
    this.broker.on('client', (client) => {
      this.logger.info(`Client connected: ${client.id}`);
    });

    // Client disconnection handler
    this.broker.on('clientDisconnect', (client) => {
      this.logger.info(`Client disconnected: ${client.id}`);
    });

    // Message publication handler
    this.broker.on('publish', (packet, client) => {
      if (client && packet.topic !== '$SYS/broker/heartbeat') {
        this.logger.debug(`Message published by ${client.id} to ${packet.topic}`);
      }
    });

    // Subscription handler
    this.broker.on('subscribe', (subscriptions, client) => {
      this.logger.debug(`Client ${client.id} subscribed to:`, subscriptions.map(s => s.topic));
    });

    // Error handler
    this.broker.on('error', (error) => {
      this.logger.error('MQTT broker error:', error);
    });
  }

  createInternalClient() {
    this.internalClient = mqtt.connect(`mqtt://localhost:${this.config.port}`, {
      clientId: 'UCI_INTERNAL_CLIENT',
      clean: true,
      connectTimeout: 5000,
      reconnectPeriod: 1000
    });

    this.internalClient.on('connect', () => {
      this.logger.info('Internal MQTT client connected');
    });

    this.internalClient.on('error', (error) => {
      this.logger.error('Internal MQTT client error:', error);
    });

    this.internalClient.on('offline', () => {
      this.logger.warn('Internal MQTT client offline');
    });
  }

  getClient() {
    return this.internalClient;
  }

  async publish(topic, message, options = {}) {
    return new Promise((resolve, reject) => {
      if (!this.internalClient || !this.internalClient.connected) {
        // If internal client not ready, publish directly through broker
        const payload = typeof message === 'string' ? message : JSON.stringify(message);
        const packet = {
          cmd: 'publish',
          topic: topic,
          payload: payload,
          qos: options.qos || 0,
          retain: options.retain || false
        };
        
        this.broker.publish(packet, () => {
          this.logger.debug(`Published to ${topic} via broker`);
          resolve();
        });
        return;
      }

      // IMPORTANT: Always ensure payload is a string
      const payload = typeof message === 'string' ? message : JSON.stringify(message);
      
      this.internalClient.publish(topic, payload, {
        qos: options.qos || 0,
        retain: options.retain || false,
        ...options
      }, (error) => {
        if (error) {
          this.logger.error(`Failed to publish to ${topic}:`, error);
          reject(error);
        } else {
          this.logger.debug(`Published to ${topic}: ${payload.substring(0, 100)}...`);
          resolve();
        }
      });
    });
  }

  getStatus() {
    return {
      isRunning: this.isRunning,
      config: this.config,
      connectedClients: this.broker ? Object.keys(this.broker.clients).length : 0,
      internalClientConnected: this.internalClient ? this.internalClient.connected : false
    };
  }

  async stop() {
    this.logger.info('Stopping MQTT server...');
    
    if (this.internalClient) {
      this.internalClient.end();
    }
    
    if (this.wsServer) {
      this.wsServer.close();
    }
    
    if (this.broker) {
      this.broker.close();
    }
    
    if (this.server) {
      return new Promise((resolve) => {
        this.server.close(() => {
          this.isRunning = false;
          this.logger.info('MQTT server stopped');
          resolve();
        });
      });
    }
  }
}

module.exports = { MQTTServer };