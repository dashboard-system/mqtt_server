const { SystemLogger } = require('../utils/logger')

class UCIParser {
  constructor() {
    this.logger = new SystemLogger('UCIParser')
  }

  /**
   * Parse UCI file content into sections
   * @param {string} content - UCI file content
   * @returns {Map} - Map of section data
   */
  parse(content) {
    const sections = new Map()
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'))

    let currentSection = null
    let currentSectionData = null

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]

      try {
        if (line.startsWith('config ')) {
          // Save previous section if exists
          if (currentSection && currentSectionData) {
            sections.set(currentSection, currentSectionData)
          }

          // Parse section header: config <type> ['<n>']
          const match = line.match(/^config\s+(\w+)\s*(?:'([^']+)')?/)
          if (!match) {
            throw new Error(`Invalid config line: ${line}`)
          }

          const [, sectionType, sectionName] = match
          currentSection = sectionName || `${sectionType}_${i}`

          currentSectionData = {
            sectionType,
            sectionName: sectionName || currentSection,
            values: {},
            lineNumber: i + 1,
            uuid: null, // Will be set if found in options
          }
        } else if (line.startsWith('option ')) {
          // Parse option: option <key> <value>
          const optionMatch = line.match(/^option\s+(\w+)\s+(.+)$/)
          if (!optionMatch) {
            throw new Error(`Invalid option line: ${line}`)
          }

          const [, key, value] = optionMatch
          if (currentSectionData) {
            const parsedValue = this.parseValue(value)

            // Special handling for UUID option
            if (key === 'uuid') {
              currentSectionData.uuid = parsedValue
            } else {
              currentSectionData.values[key] = parsedValue
            }
          }
        } else if (line.startsWith('list ')) {
          // Parse list: list <key> <value>
          const listMatch = line.match(/^list\s+(\w+)\s+(.+)$/)
          if (!listMatch) {
            throw new Error(`Invalid list line: ${line}`)
          }

          const [, key, value] = listMatch
          if (currentSectionData) {
            if (!currentSectionData.values[key]) {
              currentSectionData.values[key] = []
            }
            if (Array.isArray(currentSectionData.values[key])) {
              currentSectionData.values[key].push(this.parseValue(value))
            }
          }
        }
      } catch (error) {
        this.logger.error(`Error parsing line ${i + 1}: ${line}`, error)
        throw new Error(`Parse error at line ${i + 1}: ${error.message}`)
      }
    }

    // Save last section
    if (currentSection && currentSectionData) {
      sections.set(currentSection, currentSectionData)
    }

    this.logger.debug(`Parsed ${sections.size} sections from UCI content`)
    return sections
  }

  /**
   * Parse a UCI value (handle quotes, arrays, etc.)
   * @param {string} value - Raw value from UCI file
   * @returns {string|number|boolean} - Parsed value
   */
  parseValue(value) {
    // Remove quotes if present
    if (
      (value.startsWith("'") && value.endsWith("'")) ||
      (value.startsWith('"') && value.endsWith('"'))
    ) {
      value = value.slice(1, -1)
    }

    // Try to parse as number
    if (/^\d+$/.test(value)) {
      return parseInt(value, 10)
    }

    // Try to parse as boolean
    if (value === 'true' || value === '1') {
      return true
    }
    if (value === 'false' || value === '0') {
      return false
    }

    return value
  }

  /**
   * Serialize sections back to UCI format with UUIDs
   * @param {Map} sections - Map of section data with UUIDs
   * @returns {string} - UCI file content
   */
  serialize(sections) {
    const lines = []

    for (const [sectionKey, sectionData] of sections) {
      // Write section header
      const sectionName = sectionData.sectionName || sectionKey
      if (sectionName === sectionData.sectionType || !sectionName) {
        lines.push(`config ${sectionData.sectionType}`)
      } else {
        lines.push(`config ${sectionData.sectionType} '${sectionName}'`)
      }

      // IMPORTANT: Write UUID first if it exists
      if (sectionData.uuid) {
        lines.push(`\toption uuid '${sectionData.uuid}'`)
      }

      // Write options and lists
      for (const [key, value] of Object.entries(sectionData.values)) {
        if (Array.isArray(value)) {
          // Write as list entries
          for (const item of value) {
            lines.push(`\tlist ${key} ${this.serializeValue(item)}`)
          }
        } else {
          // Write as option
          lines.push(`\toption ${key} ${this.serializeValue(value)}`)
        }
      }

      lines.push('') // Empty line between sections
    }

    return lines.join('\n')
  }

  /**
   * Serialize a value for UCI output
   * @param {any} value - Value to serialize
   * @returns {string} - Serialized value
   */
  serializeValue(value) {
    if (typeof value === 'string') {
      // Quote strings that contain spaces or special characters
      if (
        value.includes(' ') ||
        value.includes('\t') ||
        value.includes("'") ||
        value.includes('"')
      ) {
        return `'${value.replace(/'/g, "\\'")}`
      }
      return value
    }

    if (typeof value === 'boolean') {
      return value ? '1' : '0'
    }

    return String(value)
  }

  /**
   * Validate UCI syntax
   * @param {string} content - UCI content to validate
   * @returns {Object} - Validation result
   */
  validate(content) {
    try {
      const sections = this.parse(content)
      return {
        valid: true,
        sections: sections.size,
        errors: [],
      }
    } catch (error) {
      return {
        valid: false,
        sections: 0,
        errors: [error.message],
      }
    }
  }
}

module.exports = { UCIParser }
