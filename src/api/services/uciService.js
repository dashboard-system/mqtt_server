const { v4: uuidv4 } = require('uuid')

class UCIService {
  constructor() {
    this.mqttClient = null
    this.logger = null
  }

  setMQTTClient(client) {
    this.mqttClient = client
  }

  setLogger(logger) {
    this.logger = logger
  }

  async listUCIFiles() {
    try {
      // Query MQTT for available config topics
      const topics = await this.queryMQTTTopics('config/+/+/+', 2000)
      const files = [
        ...new Set(
          topics.map((topic) => {
            const parts = topic.split('/')
            return parts[1] // fileName
          }),
        ),
      ]

      return {
        files,
        count: files.length,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      this.logger?.error('Error listing UCI files:', error)
      throw error
    }
  }

  async getUCIFile(fileName) {
    try {
      const sections = await this.queryMQTTData(`config/${fileName}/+/+`, 3000)

      return {
        fileName,
        sections,
        count: sections.length,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      this.logger?.error(`Error getting UCI file ${fileName}:`, error)
      throw error
    }
  }

  async getUCISections(fileName, sectionName) {
    try {
      const sections = await this.queryMQTTData(
        `config/${fileName}/${sectionName}/+`,
        3000,
      )

      return {
        fileName,
        sectionName,
        sections,
        count: sections.length,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      this.logger?.error(
        `Error getting UCI sections ${fileName}/${sectionName}:`,
        error,
      )
      throw error
    }
  }

  async getUCISection(fileName, sectionName, uuid) {
    try {
      const topic = `config/${fileName}/${sectionName}/${uuid}`
      const section = await this.getMQTTMessage(topic, 2000)

      return {
        fileName,
        sectionName,
        uuid,
        section,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      this.logger?.error(
        `Error getting UCI section ${fileName}/${sectionName}/${uuid}:`,
        error,
      )
      throw error
    }
  }

  async createUCISection(fileName, sectionName, values) {
    try {
      const requestId = uuidv4()
      const command = {
        action: 'create',
        fileName,
        sectionName,
        values,
        requestId,
        timestamp: new Date().toISOString(),
      }

      await this.publishMQTTMessage('commands/edit', JSON.stringify(command))

      return {
        message: 'Create command sent',
        fileName,
        sectionName,
        values,
        requestId,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      this.logger?.error(
        `Error creating UCI section ${fileName}/${sectionName}:`,
        error,
      )
      throw error
    }
  }

  async updateUCISection(fileName, sectionName, uuid, values) {
    try {
      const requestId = uuidv4()
      const command = {
        action: 'update',
        fileName,
        sectionName,
        uuid,
        values,
        requestId,
        timestamp: new Date().toISOString(),
      }

      await this.publishMQTTMessage('commands/edit', JSON.stringify(command))

      return {
        message: 'Update command sent',
        fileName,
        sectionName,
        uuid,
        values,
        requestId,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      this.logger?.error(
        `Error updating UCI section ${fileName}/${sectionName}/${uuid}:`,
        error,
      )
      throw error
    }
  }

  async deleteUCISection(fileName, sectionName, uuid) {
    try {
      const requestId = uuidv4()
      const command = {
        action: 'delete',
        fileName,
        sectionName,
        uuid,
        requestId,
        timestamp: new Date().toISOString(),
      }

      await this.publishMQTTMessage('commands/edit', JSON.stringify(command))

      return {
        message: 'Delete command sent',
        fileName,
        sectionName,
        uuid,
        requestId,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      this.logger?.error(
        `Error deleting UCI section ${fileName}/${sectionName}/${uuid}:`,
        error,
      )
      throw error
    }
  }

  async reloadUCIFile(fileName) {
    try {
      const command = {
        fileName,
        timestamp: new Date().toISOString(),
      }

      await this.publishMQTTMessage('commands/reload', JSON.stringify(command))

      return {
        message: 'Reload command sent',
        fileName,
        timestamp: new Date().toISOString(),
      }
    } catch (error) {
      this.logger?.error(`Error reloading UCI file ${fileName}:`, error)
      throw error
    }
  }

  // MQTT Helper Methods
  async publishMQTTMessage(topic, message) {
    return new Promise((resolve, reject) => {
      if (!this.mqttClient || !this.mqttClient.connected) {
        reject(new Error('MQTT client not connected'))
        return
      }

      const payload =
        typeof message === 'string' ? message : JSON.stringify(message)

      this.mqttClient.publish(topic, payload, (error) => {
        if (error) {
          reject(error)
        } else {
          this.logger?.debug(`Published to ${topic}`)
          resolve()
        }
      })
    })
  }

  async getMQTTMessage(topic, timeout = 5000) {
    return new Promise((resolve) => {
      if (!this.mqttClient || !this.mqttClient.connected) {
        resolve(null)
        return
      }

      const timer = setTimeout(() => {
        this.mqttClient.unsubscribe(topic)
        resolve(null)
      }, timeout)

      this.mqttClient.subscribe(topic, (error) => {
        if (error) {
          clearTimeout(timer)
          resolve(null)
          return
        }

        const messageHandler = (receivedTopic, message) => {
          if (receivedTopic === topic) {
            clearTimeout(timer)
            this.mqttClient.unsubscribe(topic)
            this.mqttClient.removeListener('message', messageHandler)

            try {
              const parsed = JSON.parse(message.toString())
              resolve(parsed)
            } catch (parseError) {
              resolve(message.toString())
            }
          }
        }

        this.mqttClient.on('message', messageHandler)
      })
    })
  }

  async queryMQTTData(topicPattern, timeout = 3000) {
    return new Promise((resolve) => {
      if (!this.mqttClient || !this.mqttClient.connected) {
        resolve([])
        return
      }

      const results = []
      const timer = setTimeout(() => {
        this.mqttClient.unsubscribe(topicPattern)
        this.mqttClient.removeListener('message', messageHandler)
        resolve(results)
      }, timeout)

      const messageHandler = (topic, message) => {
        if (this.topicMatches(topicPattern, topic)) {
          try {
            const parts = topic.split('/')
            const data = JSON.parse(message.toString())
            results.push({
              topic,
              fileName: parts[1],
              sectionName: parts[2],
              uuid: parts[3],
              data,
            })
          } catch (parseError) {
            // Ignore parse errors
          }
        }
      }

      this.mqttClient.subscribe(topicPattern, (error) => {
        if (error) {
          clearTimeout(timer)
          resolve([])
          return
        }

        this.mqttClient.on('message', messageHandler)
      })
    })
  }

  async queryMQTTTopics(topicPattern, timeout = 2000) {
    return new Promise((resolve) => {
      if (!this.mqttClient || !this.mqttClient.connected) {
        resolve([])
        return
      }

      const topics = new Set()
      const timer = setTimeout(() => {
        this.mqttClient.unsubscribe(topicPattern)
        this.mqttClient.removeListener('message', messageHandler)
        resolve([...topics])
      }, timeout)

      const messageHandler = (topic, message) => {
        if (this.topicMatches(topicPattern, topic)) {
          topics.add(topic)
        }
      }

      this.mqttClient.subscribe(topicPattern, (error) => {
        if (error) {
          clearTimeout(timer)
          resolve([])
          return
        }

        this.mqttClient.on('message', messageHandler)
      })
    })
  }

  topicMatches(pattern, topic) {
    const patternParts = pattern.split('/')
    const topicParts = topic.split('/')

    if (patternParts.length !== topicParts.length) {
      return false
    }

    for (let i = 0; i < patternParts.length; i++) {
      if (patternParts[i] !== '+' && patternParts[i] !== topicParts[i]) {
        return false
      }
    }

    return true
  }
}

module.exports = { UCIService }
