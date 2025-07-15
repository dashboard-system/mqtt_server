// Jest setup file
// This file is executed before each test file

// Set test environment variables
process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'error'
process.env.MQTT_PORT = '1884' // Use different port for tests
process.env.WEB_PORT = '3002'  // Use different port for tests
process.env.UCI_DIR = './test-uci'
process.env.BACKUP_DIR = './test-uci-backup'

// Mock console for cleaner test output
global.console = {
  ...console,
  // Uncomment to suppress logs during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  error: console.error, // Keep errors visible
}

// Global test timeout
jest.setTimeout(10000)

// Clean up after tests
afterEach(() => {
  // Add any cleanup logic here
  jest.clearAllMocks()
})