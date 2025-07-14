const Joi = require('joi')

class UCIValidation {
  constructor() {
    this.setupSchemas()
  }

  setupSchemas() {
    // Schema for UCI section values
    this.sectionValuesSchema = Joi.object().pattern(
      Joi.string(),
      Joi.alternatives().try(
        Joi.string(),
        Joi.number(),
        Joi.boolean(),
        Joi.array().items(Joi.string(), Joi.number(), Joi.boolean()),
      ),
    )

    // Schema for edit commands
    this.editCommandSchema = Joi.object({
      action: Joi.string().valid('create', 'update', 'delete').required(),
      fileName: Joi.string()
        .pattern(/^[a-zA-Z0-9_-]+$/)
        .required(),
      sectionName: Joi.string()
        .pattern(/^[a-zA-Z0-9_-]+$/)
        .required(),
      uuid: Joi.string()
        .uuid()
        .when('action', {
          is: Joi.string().valid('update', 'delete'),
          then: Joi.required(),
          otherwise: Joi.optional(),
        }),
      values: Joi.when('action', {
        is: 'delete',
        then: Joi.optional(),
        otherwise: this.sectionValuesSchema.required(),
      }),
      requestId: Joi.string().optional(),
    })

    // Schema for reload commands
    this.reloadCommandSchema = Joi.object({
      fileName: Joi.string()
        .pattern(/^[a-zA-Z0-9_-]+$/)
        .required(),
    })

    // Schema for validate commands
    this.validateCommandSchema = Joi.object({
      fileName: Joi.string()
        .pattern(/^[a-zA-Z0-9_-]+$/)
        .optional(),
      content: Joi.string().required(),
    })
  }

  validateSectionValues(values) {
    const { error, value } = this.sectionValuesSchema.validate(values)

    if (error) {
      return {
        valid: false,
        errors: error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
        })),
      }
    }

    return {
      valid: true,
      value,
    }
  }

  validateEditCommand(command) {
    const { error, value } = this.editCommandSchema.validate(command)

    if (error) {
      return {
        valid: false,
        errors: error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
        })),
      }
    }

    return {
      valid: true,
      value,
    }
  }

  validateReloadCommand(command) {
    const { error, value } = this.reloadCommandSchema.validate(command)

    if (error) {
      return {
        valid: false,
        errors: error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
        })),
      }
    }

    return {
      valid: true,
      value,
    }
  }

  validateValidateCommand(command) {
    const { error, value } = this.validateCommandSchema.validate(command)

    if (error) {
      return {
        valid: false,
        errors: error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
        })),
      }
    }

    return {
      valid: true,
      value,
    }
  }

  // Validate file names to prevent path traversal
  validateFileName(fileName) {
    if (!fileName) {
      return { valid: false, error: 'File name is required' }
    }

    if (
      fileName.includes('..') ||
      fileName.includes('/') ||
      fileName.includes('\\')
    ) {
      return {
        valid: false,
        error: 'Invalid file name: path traversal not allowed',
      }
    }

    if (fileName.startsWith('.')) {
      return {
        valid: false,
        error: 'Invalid file name: hidden files not allowed',
      }
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(fileName)) {
      return {
        valid: false,
        error:
          'Invalid file name: only alphanumeric, underscore, and dash allowed',
      }
    }

    return { valid: true }
  }

  // Validate section names
  validateSectionName(sectionName) {
    if (!sectionName) {
      return { valid: false, error: 'Section name is required' }
    }

    if (!/^[a-zA-Z0-9_-]+$/.test(sectionName)) {
      return {
        valid: false,
        error:
          'Invalid section name: only alphanumeric, underscore, and dash allowed',
      }
    }

    return { valid: true }
  }

  // Validate UUIDs
  validateUUID(uuid) {
    if (!uuid) {
      return { valid: false, error: 'UUID is required' }
    }

    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (!uuidRegex.test(uuid)) {
      return { valid: false, error: 'Invalid UUID format' }
    }

    return { valid: true }
  }

  // Validate UCI configuration values based on common patterns
  validateUCIValue(key, value, sectionType) {
    const validationRules = this.getValidationRules(sectionType)

    if (validationRules[key]) {
      const rule = validationRules[key]
      const { error } = rule.validate(value)

      if (error) {
        return {
          valid: false,
          error: `Invalid value for ${key}: ${error.message}`,
        }
      }
    }

    return { valid: true }
  }

  // Get validation rules based on section type
  getValidationRules(sectionType) {
    const rules = {
      interface: {
        proto: Joi.string().valid('static', 'dhcp', 'pppoe', 'none'),
        ifname: Joi.string().pattern(/^[a-zA-Z0-9._-]+$/),
        ipaddr: Joi.string().ip({ version: ['ipv4'] }),
        netmask: Joi.string().ip({ version: ['ipv4'] }),
        gateway: Joi.string().ip({ version: ['ipv4'] }),
        dns: Joi.array().items(Joi.string().ip({ version: ['ipv4', 'ipv6'] })),
        metric: Joi.number().integer().min(0).max(9999),
      },
      'wifi-device': {
        type: Joi.string().valid('mac80211', 'broadcom'),
        channel: Joi.alternatives().try(
          Joi.string().valid('auto'),
          Joi.number().integer().min(1).max(165),
        ),
        hwmode: Joi.string().valid('11b', '11g', '11a', '11n', '11ac'),
        htmode: Joi.string().valid(
          'HT20',
          'HT40',
          'VHT20',
          'VHT40',
          'VHT80',
          'VHT160',
        ),
        txpower: Joi.number().integer().min(0).max(30),
        disabled: Joi.boolean(),
      },
      'wifi-iface': {
        device: Joi.string(),
        network: Joi.string(),
        mode: Joi.string().valid('ap', 'sta', 'adhoc', 'monitor'),
        ssid: Joi.string().max(32),
        encryption: Joi.string().valid(
          'none',
          'wep',
          'psk',
          'psk2',
          'wpa',
          'wpa2',
        ),
        key: Joi.string().min(8).max(64),
        hidden: Joi.boolean(),
        isolate: Joi.boolean(),
      },
      firewall: {
        input: Joi.string().valid('ACCEPT', 'REJECT', 'DROP'),
        output: Joi.string().valid('ACCEPT', 'REJECT', 'DROP'),
        forward: Joi.string().valid('ACCEPT', 'REJECT', 'DROP'),
        masq: Joi.boolean(),
        mtu_fix: Joi.boolean(),
      },
      rule: {
        name: Joi.string(),
        src: Joi.string(),
        dest: Joi.string(),
        proto: Joi.string().valid('tcp', 'udp', 'icmp', 'all'),
        src_port: Joi.alternatives().try(
          Joi.number().integer().min(1).max(65535),
          Joi.string().pattern(/^\d+(-\d+)?$/),
        ),
        dest_port: Joi.alternatives().try(
          Joi.number().integer().min(1).max(65535),
          Joi.string().pattern(/^\d+(-\d+)?$/),
        ),
        target: Joi.string().valid('ACCEPT', 'REJECT', 'DROP'),
      },
    }

    return rules[sectionType] || {}
  }
}
// Sanitize values to prevent
