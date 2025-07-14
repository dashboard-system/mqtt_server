const fs = require('fs-extra')
const path = require('path')
const chokidar = require('chokidar')
const { v4: uuidv4 } = require('uuid')
const { UCIParser } = require('./uciParser')
const { SystemLogger } = require('../utils/logger')

class UCIManager {
  constructor(config = {}) {
    this.config = {
      uciDirectory: config.uciDirectory || './uci',
      backupDirectory: config.backupDirectory || './uci_backup',
      watchFiles: config.watchFiles !== false,
      ...config,
    }

    this.logger = new SystemLogger('UCIManager')
    this.parser = new UCIParser()
    this.mqttClient = null
    this.fileWatcher = null
    this.uciFiles = new Map() // fileName -> { sections: Map, lastModified: Date }
    this.isInitialized = false
  }

  async initialize() {
    try {
      this.logger.info('Initializing UCI Manager...')

      // Ensure directories exist
      await this.ensureDirectories()

      // Load all UCI files
      await this.loadAllUCIFiles()

      // Setup file watching
      if (this.config.watchFiles) {
        this.setupFileWatcher()
      }

      this.isInitialized = true
      this.logger.info('UCI Manager initialized successfully')
    } catch (error) {
      this.logger.error('Failed to initialize UCI Manager:', error)
      throw error
    }
  }

  async ensureDirectories() {
    try {
      await fs.ensureDir(this.config.uciDirectory)
      await fs.ensureDir(this.config.backupDirectory)
    } catch (error) {
      this.logger.error('Failed to create directories:', error)
      throw error
    }
  }

  async loadAllUCIFiles() {
    try {
      const files = await fs.readdir(this.config.uciDirectory)

      for (const file of files) {
        const filePath = path.join(this.config.uciDirectory, file)
        const stat = await fs.stat(filePath)

        if (stat.isFile() && !file.startsWith('.')) {
          await this.loadUCIFile(file)
        }
      }

      this.logger.info(`Loaded ${this.uciFiles.size} UCI files`)
    } catch (error) {
      this.logger.error('Error loading UCI files:', error)
      throw error
    }
  }

  async loadUCIFile(fileName) {
    try {
      const filePath = path.join(this.config.uciDirectory, fileName)
      const content = await fs.readFile(filePath, 'utf8')
      const stat = await fs.stat(filePath)

      // Parse UCI file
      const sections = this.parser.parse(content)

      // Generate UUIDs for sections without them
      const sectionsWithUUIDs = new Map()
      for (const [sectionKey, sectionData] of sections) {
        const uuid = sectionData.uuid || uuidv4()
        sectionsWithUUIDs.set(uuid, {
          ...sectionData,
          uuid,
          sectionKey,
        })
      }

      // Store in memory
      this.uciFiles.set(fileName, {
        sections: sectionsWithUUIDs,
        lastModified: stat.mtime,
        content: content,
      })

      this.logger.debug(
        `Loaded UCI file: ${fileName} (${sectionsWithUUIDs.size} sections)`,
      )

      // Publish to MQTT if connected
      if (this.mqttClient) {
        await this.publishUCIFile(fileName)
      }
    } catch (error) {
      this.logger.error(`Error loading UCI file ${fileName}:`, error)
      throw error
    }
  }

  async publishUCIFile(fileName) {
    try {
      const fileData = this.uciFiles.get(fileName)
      if (!fileData) {
        this.logger.warn(`UCI file ${fileName} not found in memory`)
        return
      }

      for (const [uuid, sectionData] of fileData.sections) {
        const topic = `config/${fileName}/${sectionData.sectionType}/${uuid}`

        // Publish only the configuration values, not metadata
        const configValues = { ...sectionData.values }

        await this.mqttClient.publish(topic, configValues, { retain: true })

        this.logger.debug(`Published section ${uuid} to ${topic}`)
      }

      // Publish file status
      await this.publishSystemStatus(
        fileName,
        'loaded',
        'UCI file loaded successfully',
      )
    } catch (error) {
      this.logger.error(`Error publishing UCI file ${fileName}:`, error)
      throw error
    }
  }

  async publishSystemStatus(fileName, status, message) {
    try {
      const statusMessage = {
        fileName,
        status,
        message,
        timestamp: new Date().toISOString(),
      }

      await this.mqttClient.publish('system/status', statusMessage)
    } catch (error) {
      this.logger.error('Error publishing system status:', error)
    }
  }

  setupFileWatcher() {
    this.fileWatcher = chokidar.watch(this.config.uciDirectory, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: {
        stabilityThreshold: 100,
        pollInterval: 100,
      },
    })

    this.fileWatcher.on('change', async (filePath) => {
      const fileName = path.basename(filePath)
      this.logger.info(`UCI file changed: ${fileName}`)

      try {
        await this.loadUCIFile(fileName)
      } catch (error) {
        this.logger.error(`Error reloading changed file ${fileName}:`, error)
      }
    })

    this.fileWatcher.on('add', async (filePath) => {
      const fileName = path.basename(filePath)
      this.logger.info(`New UCI file added: ${fileName}`)

      try {
        await this.loadUCIFile(fileName)
      } catch (error) {
        this.logger.error(`Error loading new file ${fileName}:`, error)
      }
    })

    this.fileWatcher.on('unlink', (filePath) => {
      const fileName = path.basename(filePath)
      this.logger.info(`UCI file removed: ${fileName}`)
      this.uciFiles.delete(fileName)
    })
  }

  async connectToMQTT(mqttClient) {
    this.mqttClient = mqttClient

    // Subscribe to command topics
    await this.mqttClient.subscribe('commands/+', this.handleCommand.bind(this))

    // Publish all loaded files
    for (const fileName of this.uciFiles.keys()) {
      await this.publishUCIFile(fileName)
    }

    this.logger.info('Connected to MQTT and published all UCI files')
  }

  async handleCommand(topic, message) {
    try {
      const command = topic.split('/')[1]

      switch (command) {
        case 'edit':
          await this.handleEditCommand(message)
          break
        case 'reload':
          await this.handleReloadCommand(message)
          break
        case 'validate':
          await this.handleValidateCommand(message)
          break
        default:
          this.logger.warn(`Unknown command: ${command}`)
      }
    } catch (error) {
      this.logger.error(`Error handling command ${topic}:`, error)
    }
  }

  async handleEditCommand(message) {
    const { action, fileName, sectionName, uuid, values, requestId } = message

    try {
      switch (action) {
        case 'create':
          await this.createSection(fileName, sectionName, values, requestId)
          break
        case 'update':
          await this.updateSection(
            fileName,
            sectionName,
            uuid,
            values,
            requestId,
          )
          break
        case 'delete':
          await this.deleteSection(fileName, sectionName, uuid, requestId)
          break
        default:
          throw new Error(`Unknown edit action: ${action}`)
      }
    } catch (error) {
      this.logger.error(`Error executing edit command:`, error)
      await this.publishSystemStatus(fileName, 'error', error.message)
    }
  }

  async createSection(fileName, sectionName, values, requestId) {
    const fileData = this.uciFiles.get(fileName)
    if (!fileData) {
      throw new Error(`UCI file ${fileName} not found`)
    }

    const uuid = uuidv4()
    const sectionData = {
      uuid,
      sectionKey: `${sectionName}_${uuid.substr(0, 8)}`,
      sectionType: sectionName,
      values,
    }

    // Add to memory
    fileData.sections.set(uuid, sectionData)

    // Save to file
    await this.saveUCIFile(fileName)

    // Publish to MQTT
    const topic = `config/${fileName}/${sectionName}/${uuid}`
    await this.mqttClient.publish(topic, values, { retain: true })

    await this.publishSystemStatus(
      fileName,
      'created',
      `Section ${uuid} created successfully`,
    )

    this.logger.info(`Created section ${uuid} in ${fileName}`)
  }

  async updateSection(fileName, sectionName, uuid, values, requestId) {
    const fileData = this.uciFiles.get(fileName)
    if (!fileData) {
      throw new Error(`UCI file ${fileName} not found`)
    }

    const section = fileData.sections.get(uuid)
    if (!section) {
      throw new Error(`Section ${uuid} not found in ${fileName}`)
    }

    // Update values
    section.values = { ...section.values, ...values }

    // Save to file
    await this.saveUCIFile(fileName)

    // Publish to MQTT
    const topic = `config/${fileName}/${sectionName}/${uuid}`
    await this.mqttClient.publish(topic, section.values, { retain: true })

    await this.publishSystemStatus(
      fileName,
      'updated',
      `Section ${uuid} updated successfully`,
    )

    this.logger.info(`Updated section ${uuid} in ${fileName}`)
  }

  async deleteSection(fileName, sectionName, uuid, requestId) {
    const fileData = this.uciFiles.get(fileName)
    if (!fileData) {
      throw new Error(`UCI file ${fileName} not found`)
    }

    if (!fileData.sections.has(uuid)) {
      throw new Error(`Section ${uuid} not found in ${fileName}`)
    }

    // Remove from memory
    fileData.sections.delete(uuid)

    // Save to file
    await this.saveUCIFile(fileName)

    // Remove from MQTT (publish empty retained message)
    const topic = `config/${fileName}/${sectionName}/${uuid}`
    await this.mqttClient.publish(topic, '', { retain: true })

    await this.publishSystemStatus(
      fileName,
      'deleted',
      `Section ${uuid} deleted successfully`,
    )

    this.logger.info(`Deleted section ${uuid} from ${fileName}`)
  }

  async saveUCIFile(fileName) {
    try {
      const fileData = this.uciFiles.get(fileName)
      if (!fileData) {
        throw new Error(`UCI file ${fileName} not found in memory`)
      }

      // Create backup first
      const filePath = path.join(this.config.uciDirectory, fileName)
      const backupPath = path.join(
        this.config.backupDirectory,
        `${fileName}.${Date.now()}.backup`,
      )

      if (await fs.pathExists(filePath)) {
        await fs.copy(filePath, backupPath)
      }

      // Generate UCI content from sections
      const uciContent = this.parser.serialize(fileData.sections)

      // Write to file
      await fs.writeFile(filePath, uciContent, 'utf8')

      // Update memory
      fileData.content = uciContent
      fileData.lastModified = new Date()

      this.logger.debug(`Saved UCI file: ${fileName}`)
    } catch (error) {
      this.logger.error(`Error saving UCI file ${fileName}:`, error)
      throw error
    }
  }

  async handleReloadCommand(message) {
    const { fileName } = message

    try {
      await this.loadUCIFile(fileName)
      await this.publishSystemStatus(
        fileName,
        'reloaded',
        `File ${fileName} reloaded successfully`,
      )
    } catch (error) {
      await this.publishSystemStatus(
        fileName,
        'error',
        `Failed to reload ${fileName}: ${error.message}`,
      )
    }
  }

  async handleValidateCommand(message) {
    const { fileName, content } = message

    try {
      // Parse the content to validate
      this.parser.parse(content || '')
      await this.publishSystemStatus(fileName, 'valid', 'UCI syntax is valid')
    } catch (error) {
      await this.publishSystemStatus(
        fileName,
        'invalid',
        `UCI syntax error: ${error.message}`,
      )
    }
  }

  getStatus() {
    return {
      isInitialized: this.isInitialized,
      filesLoaded: this.uciFiles.size,
      totalSections: Array.from(this.uciFiles.values()).reduce(
        (sum, file) => sum + file.sections.size,
        0,
      ),
      config: this.config,
    }
  }

  async shutdown() {
    this.logger.info('Shutting down UCI Manager...')

    if (this.fileWatcher) {
      await this.fileWatcher.close()
    }

    this.logger.info('UCI Manager shutdown complete')
  }
}

module.exports = { UCIManager }
