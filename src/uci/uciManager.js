const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { UCIParser } = require('./uciParser');
const { SystemLogger } = require('../utils/logger');

class UCIManager {
  constructor(config = {}) {
    this.config = {
      uciDirectory: config.uciDirectory || './uci',
      backupDirectory: config.backupDirectory || './uci_backup',
      uuidMappingFile: config.uuidMappingFile || './uci_uuid_mapping.json',
      watchFiles: config.watchFiles !== false,
      writeUuidsToFiles: config.writeUuidsToFiles !== false,
      ...config
    };
    
    this.logger = new SystemLogger('UCIManager');
    this.parser = new UCIParser();
    this.mqttClient = null;
    this.uciFiles = new Map(); // fileName -> { sections: Map, lastModified: Date }
    this.uuidMapping = new Map(); // sectionKey -> uuid (persistent across restarts)
    this.isInitialized = false;
  }

  async initialize() {
    try {
      this.logger.info('Initializing UCI Manager...');

      // Ensure directories exist
      await this.ensureDirectories();

      // Load UUID mapping from file
      await this.loadUUIDMapping();

      // Load all UCI files
      await this.loadAllUCIFiles();

      // Save UUID mapping to persist any new UUIDs
      await this.saveUUIDMapping();

      this.isInitialized = true;
      this.logger.info('UCI Manager initialized successfully');
    } catch (error) {
      this.logger.error('Failed to initialize UCI Manager:', error);
      throw error;
    }
  }

  async ensureDirectories() {
    try {
      if (!fs.existsSync(this.config.uciDirectory)) {
        fs.mkdirSync(this.config.uciDirectory, { recursive: true });
      }
      if (!fs.existsSync(this.config.backupDirectory)) {
        fs.mkdirSync(this.config.backupDirectory, { recursive: true });
      }
    } catch (error) {
      this.logger.error('Failed to create directories:', error);
      throw error;
    }
  }

  async loadUUIDMapping() {
    try {
      if (fs.existsSync(this.config.uuidMappingFile)) {
        const content = fs.readFileSync(this.config.uuidMappingFile, 'utf8');
        const mapping = JSON.parse(content);
        
        // Convert object back to Map
        this.uuidMapping = new Map(Object.entries(mapping));
        this.logger.info(`Loaded ${this.uuidMapping.size} UUID mappings`);
      } else {
        this.logger.info('No existing UUID mapping file found, creating new one');
        this.uuidMapping = new Map();
      }
    } catch (error) {
      this.logger.error('Error loading UUID mapping:', error);
      this.uuidMapping = new Map();
    }
  }

  async saveUUIDMapping() {
    try {
      // Convert Map to object for JSON serialization
      const mappingObject = Object.fromEntries(this.uuidMapping);
      const content = JSON.stringify(mappingObject, null, 2);
      
      fs.writeFileSync(this.config.uuidMappingFile, content, 'utf8');
      this.logger.debug(`Saved ${this.uuidMapping.size} UUID mappings`);
    } catch (error) {
      this.logger.error('Error saving UUID mapping:', error);
    }
  }

  generateSectionKey(fileName, sectionType, sectionName, lineNumber) {
    // Create a unique key for this section that will be consistent across restarts
    if (sectionName && sectionName !== sectionType) {
      return `${fileName}:${sectionType}:${sectionName}`;
    } else {
      // For unnamed sections, use type and line number for consistency
      return `${fileName}:${sectionType}:line${lineNumber}`;
    }
  }

  getOrCreateUUID(sectionKey, existingUuid = null) {
    // If section already has a UUID in the file, use it and update mapping
    if (existingUuid) {
      this.uuidMapping.set(sectionKey, existingUuid);
      return existingUuid;
    }
    
    // Check if we have a mapping for this section
    if (this.uuidMapping.has(sectionKey)) {
      return this.uuidMapping.get(sectionKey);
    } else {
      // Generate new UUID
      const uuid = uuidv4();
      this.uuidMapping.set(sectionKey, uuid);
      this.logger.debug(`Generated new UUID ${uuid} for section ${sectionKey}`);
      return uuid;
    }
  }

  async createBackup(fileName) {
    try {
      const filePath = path.join(this.config.uciDirectory, fileName);
      const backupPath = path.join(this.config.backupDirectory, `${fileName}.${Date.now()}.backup`);
      
      if (fs.existsSync(filePath)) {
        fs.copyFileSync(filePath, backupPath);
        this.logger.debug(`Created backup: ${backupPath}`);
      }
    } catch (error) {
      this.logger.error(`Failed to create backup for ${fileName}:`, error);
    }
  }

  async writeUCIFile(fileName, sections) {
    try {
      // Create backup first
      await this.createBackup(fileName);
      
      // Serialize sections to UCI format
      const uciContent = this.parser.serialize(sections);
      
      // Write to file
      const filePath = path.join(this.config.uciDirectory, fileName);
      fs.writeFileSync(filePath, uciContent, 'utf8');
      
      this.logger.info(`Updated UCI file: ${fileName} with UUIDs`);
    } catch (error) {
      this.logger.error(`Failed to write UCI file ${fileName}:`, error);
      throw error;
    }
  }

  async loadUCIFile(fileName) {
    try {
      const filePath = path.join(this.config.uciDirectory, fileName);
      const content = fs.readFileSync(filePath, 'utf8');
      const stat = fs.statSync(filePath);
      
      // Parse UCI file
      const sections = this.parser.parse(content);
      
      // Process sections and ensure they have UUIDs
      const sectionsWithUUIDs = new Map();
      let fileModified = false;
      
      for (const [sectionKey, sectionData] of sections) {
        // Create a consistent section key for UUID mapping
        const persistentSectionKey = this.generateSectionKey(
          fileName, 
          sectionData.sectionType, 
          sectionData.sectionName, 
          sectionData.lineNumber
        );
        
        // Get or create UUID for this section (use existing UUID from file if available)
        const uuid = this.getOrCreateUUID(persistentSectionKey, sectionData.uuid);
        
        // If section didn't have a UUID, we'll need to write the file
        if (!sectionData.uuid) {
          fileModified = true;
        }
        
        sectionsWithUUIDs.set(uuid, {
          ...sectionData,
          uuid,
          sectionKey: persistentSectionKey,
          originalSectionKey: sectionKey
        });
      }
      
      // Store in memory
      this.uciFiles.set(fileName, {
        sections: sectionsWithUUIDs,
        lastModified: stat.mtime,
        content: content
      });
      
      // Write UUIDs back to file if needed and enabled
      if (fileModified && this.config.writeUuidsToFiles) {
        await this.writeUCIFile(fileName, sectionsWithUUIDs);
        
        // Update the stored content and timestamp
        const newContent = fs.readFileSync(filePath, 'utf8');
        const newStat = fs.statSync(filePath);
        this.uciFiles.get(fileName).content = newContent;
        this.uciFiles.get(fileName).lastModified = newStat.mtime;
      }
      
      this.logger.info(`Loaded UCI file: ${fileName} (${sectionsWithUUIDs.size} sections)${fileModified ? ' - Added UUIDs to file' : ''}`);
      
    } catch (error) {
      this.logger.error(`Error loading UCI file ${fileName}:`, error);
      throw error;
    }
  }

  async loadAllUCIFiles() {
    try {
      const files = fs.readdirSync(this.config.uciDirectory);
      
      for (const file of files) {
        const filePath = path.join(this.config.uciDirectory, file);
        const stat = fs.statSync(filePath);
        
        if (stat.isFile() && !file.startsWith('.')) {
          await this.loadUCIFile(file);
        }
      }
      
      this.logger.info(`Loaded ${this.uciFiles.size} UCI files`);
    } catch (error) {
      this.logger.error('Error loading UCI files:', error);
      throw error;
    }
  }

  async publishUCIFile(fileName) {
    try {
      if (!this.mqttClient) {
        this.logger.error('MQTT client not available for publishing');
        throw new Error('MQTT client not connected');
      }

      const fileData = this.uciFiles.get(fileName);
      if (!fileData) {
        this.logger.warn(`UCI file ${fileName} not found in memory`);
        return;
      }

      let publishedCount = 0;
      for (const [uuid, sectionData] of fileData.sections) {
        const topic = `config/${fileName}/${sectionData.sectionType}/${uuid}`;
        
        // Create a comprehensive section object with metadata
        const sectionInfo = {
          uuid: uuid,
          sectionType: sectionData.sectionType,
          sectionName: sectionData.sectionName,
          fileName: fileName,
          values: { ...sectionData.values },
          lastModified: fileData.lastModified.toISOString()
        };
        
        try {
          // Convert to JSON string for MQTT
          const payload = JSON.stringify(sectionInfo, null, 2);
          await this.mqttClient.publish(topic, payload, { retain: true });
          publishedCount++;
          this.logger.debug(`Published section ${sectionData.sectionName || sectionData.sectionType} (${uuid}) to ${topic}`);
        } catch (publishError) {
          this.logger.error(`Failed to publish section ${uuid}:`, publishError);
        }
      }
      
      this.logger.info(`Published ${publishedCount} sections from ${fileName}`);
      
      // Publish file status
      await this.publishSystemStatus(fileName, 'loaded', `UCI file loaded successfully with ${publishedCount} sections`);
      
    } catch (error) {
      this.logger.error(`Error publishing UCI file ${fileName}:`, error);
      throw error;
    }
  }

  async publishSystemStatus(fileName, status, message) {
    try {
      if (!this.mqttClient) {
        this.logger.warn('MQTT client not available for status publishing');
        return;
      }

      const statusMessage = {
        fileName,
        status,
        message,
        timestamp: new Date().toISOString(),
        totalSections: this.uciFiles.get(fileName)?.sections.size || 0
      };
      
      // Convert to JSON string for MQTT
      const payload = JSON.stringify(statusMessage, null, 2);
      await this.mqttClient.publish('system/status', payload, { retain: true });
      this.logger.debug(`Published system status for ${fileName}`);
    } catch (error) {
      this.logger.error('Error publishing system status:', error);
    }
  }

  async connectToMQTT(mqttClient) {
    if (!mqttClient) {
      throw new Error('Invalid MQTT client provided');
    }

    if (!mqttClient.connected) {
      throw new Error('MQTT client is not connected');
    }

    this.mqttClient = mqttClient;
    
    // Subscribe to command topics
    this.mqttClient.subscribe('commands/edit', (error) => {
      if (error) {
        this.logger.error('Failed to subscribe to commands/edit:', error);
      } else {
        this.logger.info('Subscribed to commands/edit');
      }
    });
    
    this.mqttClient.subscribe('commands/reload', (error) => {
      if (error) {
        this.logger.error('Failed to subscribe to commands/reload:', error);
      } else {
        this.logger.info('Subscribed to commands/reload');
      }
    });
    
    // Handle incoming messages
    this.mqttClient.on('message', (topic, message) => {
      this.handleMQTTMessage(topic, message);
    });
    
    // Publish a server startup message
    const startupMessage = {
      event: 'server_startup',
      timestamp: new Date().toISOString(),
      totalFiles: this.uciFiles.size,
      totalSections: Array.from(this.uciFiles.values()).reduce((sum, file) => sum + file.sections.size, 0),
      uuidMappings: this.uuidMapping.size,
      writeUuidsToFiles: this.config.writeUuidsToFiles
    };
    
    try {
      await this.mqttClient.publish('system/startup', JSON.stringify(startupMessage, null, 2), { retain: true });
    } catch (error) {
      this.logger.error('Failed to publish startup message:', error);
    }
    
    // Publish all loaded files
    for (const fileName of this.uciFiles.keys()) {
      try {
        await this.publishUCIFile(fileName);
      } catch (error) {
        this.logger.error(`Failed to publish UCI file ${fileName}:`, error);
      }
    }
    
    this.logger.info(`Connected to MQTT and published all UCI files. Total UUIDs: ${this.uuidMapping.size}`);
  }

  async handleMQTTMessage(topic, message) {
    try {
      if (topic === 'commands/edit') {
        const command = JSON.parse(message.toString());
        await this.handleEditCommand(command);
      } else if (topic === 'commands/reload') {
        const command = JSON.parse(message.toString());
        await this.handleReloadCommand(command);
      }
    } catch (error) {
      this.logger.error(`Error handling MQTT message on ${topic}:`, error);
    }
  }

  async handleEditCommand(command) {
    const { action, fileName, sectionName, uuid, values, requestId } = command;
    
    this.logger.info(`Processing ${action} command for ${fileName}/${sectionName}${uuid ? '/' + uuid : ''}`, { requestId });
    
    try {
      switch (action) {
        case 'create':
          await this.createSection(fileName, sectionName, values, requestId);
          break;
        case 'update':
          await this.updateSection(fileName, sectionName, uuid, values, requestId);
          break;
        case 'delete':
          await this.deleteSection(fileName, sectionName, uuid, requestId);
          break;
        default:
          throw new Error(`Unknown edit action: ${action}`);
      }
    } catch (error) {
      this.logger.error(`Error executing ${action} command:`, error);
      await this.publishCommandResponse(requestId, 'error', error.message, { fileName, sectionName, uuid });
    }
  }

  async createSection(fileName, sectionName, values, requestId) {
    const fileData = this.uciFiles.get(fileName);
    if (!fileData) {
      throw new Error(`UCI file ${fileName} not found`);
    }

    const uuid = uuidv4();
    const persistentSectionKey = this.generateSectionKey(fileName, sectionName, sectionName, Date.now());
    
    const sectionData = {
      uuid,
      sectionKey: persistentSectionKey,
      sectionType: sectionName,
      sectionName: sectionName,
      values,
      originalSectionKey: sectionName
    };

    // Add to memory
    fileData.sections.set(uuid, sectionData);

    // Update UUID mapping
    this.uuidMapping.set(persistentSectionKey, uuid);

    // Save to file
    await this.writeUCIFile(fileName, fileData.sections);

    // Update file metadata
    const stat = fs.statSync(path.join(this.config.uciDirectory, fileName));
    fileData.lastModified = stat.mtime;

    // Save UUID mapping
    await this.saveUUIDMapping();

    // Publish to MQTT
    const topic = `config/${fileName}/${sectionName}/${uuid}`;
    const sectionInfo = {
      uuid: uuid,
      sectionType: sectionName,
      sectionName: sectionName,
      fileName: fileName,
      values: { ...values },
      lastModified: fileData.lastModified.toISOString()
    };
    
    await this.mqttClient.publish(topic, JSON.stringify(sectionInfo, null, 2), { retain: true });

    await this.publishSystemStatus(fileName, 'section_created', `Section ${uuid} created successfully`);
    await this.publishCommandResponse(requestId, 'success', `Section created successfully`, { fileName, sectionName, uuid });
    
    this.logger.info(`Created section ${uuid} in ${fileName}`);
  }

  async updateSection(fileName, sectionName, uuid, values, requestId) {
    const fileData = this.uciFiles.get(fileName);
    if (!fileData) {
      throw new Error(`UCI file ${fileName} not found`);
    }

    const section = fileData.sections.get(uuid);
    if (!section) {
      throw new Error(`Section ${uuid} not found in ${fileName}`);
    }

    // Update values
    section.values = { ...section.values, ...values };

    // Save to file
    await this.writeUCIFile(fileName, fileData.sections);

    // Update file metadata
    const stat = fs.statSync(path.join(this.config.uciDirectory, fileName));
    fileData.lastModified = stat.mtime;

    // Publish to MQTT
    const topic = `config/${fileName}/${sectionName}/${uuid}`;
    const sectionInfo = {
      uuid: uuid,
      sectionType: section.sectionType,
      sectionName: section.sectionName,
      fileName: fileName,
      values: { ...section.values },
      lastModified: fileData.lastModified.toISOString()
    };
    
    await this.mqttClient.publish(topic, JSON.stringify(sectionInfo, null, 2), { retain: true });

    await this.publishSystemStatus(fileName, 'section_updated', `Section ${uuid} updated successfully`);
    await this.publishCommandResponse(requestId, 'success', `Section updated successfully`, { fileName, sectionName, uuid });
    
    this.logger.info(`Updated section ${uuid} in ${fileName}`);
  }

  async deleteSection(fileName, sectionName, uuid, requestId) {
    const fileData = this.uciFiles.get(fileName);
    if (!fileData) {
      throw new Error(`UCI file ${fileName} not found`);
    }

    if (!fileData.sections.has(uuid)) {
      throw new Error(`Section ${uuid} not found in ${fileName}`);
    }

    // Remove from memory
    fileData.sections.delete(uuid);

    // Save to file
    await this.writeUCIFile(fileName, fileData.sections);

    // Update file metadata
    const stat = fs.statSync(path.join(this.config.uciDirectory, fileName));
    fileData.lastModified = stat.mtime;

    // Remove from MQTT (publish empty retained message)
    const topic = `config/${fileName}/${sectionName}/${uuid}`;
    await this.mqttClient.publish(topic, '', { retain: true });

    await this.publishSystemStatus(fileName, 'section_deleted', `Section ${uuid} deleted successfully`);
    await this.publishCommandResponse(requestId, 'success', `Section deleted successfully`, { fileName, sectionName, uuid });
    
    this.logger.info(`Deleted section ${uuid} from ${fileName}`);
  }

  async publishCommandResponse(requestId, status, message, data = {}) {
    try {
      const response = {
        requestId,
        status,
        message,
        data,
        timestamp: new Date().toISOString()
      };
      
      await this.mqttClient.publish(`commands/response/${requestId}`, JSON.stringify(response, null, 2));
      this.logger.debug(`Published command response for ${requestId}: ${status}`);
    } catch (error) {
      this.logger.error('Error publishing command response:', error);
    }
  }

  async handleReloadCommand(command) {
    const { fileName } = command;
    
    try {
      await this.loadUCIFile(fileName);
      await this.publishUCIFile(fileName);
      await this.publishSystemStatus(fileName, 'reloaded', `File ${fileName} reloaded successfully`);
    } catch (error) {
      await this.publishSystemStatus(fileName, 'error', `Failed to reload ${fileName}: ${error.message}`);
    }
  }

  getStatus() {
    return {
      isInitialized: this.isInitialized,
      filesLoaded: this.uciFiles.size,
      totalSections: Array.from(this.uciFiles.values())
        .reduce((sum, file) => sum + file.sections.size, 0),
      uuidMappings: this.uuidMapping.size,
      config: this.config
    };
  }

  async shutdown() {
    this.logger.info('Shutting down UCI Manager...');
    
    // Save UUID mapping before shutdown
    await this.saveUUIDMapping();
    
    this.logger.info('UCI Manager shutdown complete');
  }
}

module.exports = { UCIManager };